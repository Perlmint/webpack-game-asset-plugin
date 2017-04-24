import * as wp from "webpack";
import * as nsg from "node-sprite-generator";
import * as _glob from "glob";
import * as bb from "bluebird";
import * as _ from "lodash";
import { lookup } from "mime-types";
import { v4 as uuidV4 } from "uuid";
import { formatPath, joinPath, normalizePath, readFileAsync, relativePath, statAsync, debug, parsePath, localJoinPath } from "./util";
import { InternalOption, GameAssetPluginOption, publicOptionToprivate, File, FilesByType } from "./option";
import { processImages } from "./processImages";

const glob = bb.promisify<string[], string, _glob.IOptions>(_glob);

export default class GameAssetPlugin implements wp.Plugin {
    private option: InternalOption;
    private context: string;
    private fileDependencies: string[] = [];
    private newFileDependencies: string[] = [];
    private contextDependencies: string[] = [];
    private newContextDependencies: string[] = [];
    private startTime: number;
    private prevTimestamps: {[key: string]: number} = {};

    constructor(option: GameAssetPluginOption) {
        this.option = publicOptionToprivate(option);
        this.startTime = Date.now();
    }

    private emit(compiler: wp.Compiler, compilation: wp.Compilation, callback: (err?: Error) => void) {
        this.collectFiles()
            .then(files => this.classifyFiles(files))
            .then(fileByType => this.processAssets(compilation, fileByType))
            .then(fileByType => this.generateList(compilation, fileByType))
            .then(() => callback())
            .catch(e => {
                debug("Error occured while emitting");
                callback(e);
            });
    }

    private afterEmit(compilation: wp.Compilation, callback: (err?: Error) => void) {
        debug(`added ${this.newFileDependencies.length} file dependencies`);
        this.newFileDependencies = this.newFileDependencies.map(p => localJoinPath(this.context, p));
        debug(this.newFileDependencies[0]);
        compilation.fileDependencies.push(...this.newFileDependencies);
        this.fileDependencies.push(...this.newFileDependencies);
        debug(compilation.fileDependencies.length);
        debug(`added ${this.newContextDependencies.length} context dependencies`);
        this.newContextDependencies = this.newContextDependencies.map(p => localJoinPath(this.context, p));
        compilation.contextDependencies.push(...this.newContextDependencies);
        this.contextDependencies.push(...this.newContextDependencies);
        this.newContextDependencies = [];
        this.newFileDependencies = [];

        this.prevTimestamps = compilation.fileTimestamps;
        callback();
    }

    apply(compiler: wp.Compiler) {
        this.context = compiler.options.context;
        if (this.option.atlasMapFile && this.option.makeAtlas) {
            this.newFileDependencies.push(this.option.atlasMapFile);
        }
        compiler.plugin("emit", this.emit.bind(this, compiler));
        compiler.plugin("after-emit", this.afterEmit.bind(this));
    }

    private processAssets(compilation: wp.Compilation, fileByType: FilesByType) {
        debug("begin process assets");
        return processImages(this.context, this.option, compilation, fileByType).then(
            filesToCopy => bb.map(
                _.flatten(
                    _.map(
                        filesToCopy,
                        byType => _.values(byType)
                    )
                ),
                file => readFileAsync(file.srcFile).then(
                    content => {
                        (typeof file.outFile === "string" ? [file.outFile] : file.outFile).map(
                            outFile => compilation.assets[outFile] = {
                                size: () => content.length,
                                source: () => content
                            }
                        );
                    }
                )
            )
        ).then(
            () => fileByType
        );
    }

    private generateList(compilation: wp.Compilation, fileByType: FilesByType) {
        debug("begin generate list");
        const listData = JSON.stringify(
            _.fromPairs(
                _.map(
                    fileByType,
                    (a, ak) => [
                        ak,
                        _.fromPairs(_.map(a, (v, k) => [k, v.outFile]))
                    ]
                )
            )
        );
        compilation.assets[this.option.listOut] = {
            size: () => listData.length,
            source: () => listData,
        };
        return bb.resolve();
    }

    private collectFiles() {
        debug("collect assets");
        return bb.map(this.option.assetRoots, root => {
            const { src: srcRoot, out: outRoot } = root;
            return glob(srcRoot + "/**/*", {
                ignore: this.option.excludes
            }).then(
                items => ({
                    srcRoot,
                    outRoot,
                    items
                })
            );
        }).then(filesByRoot => _.flatten(
            _.map(filesByRoot,
                val => val.items.map<File>(
                    file => {
                        file = normalizePath(file);
                        const relPath = relativePath(val.srcRoot, file);
                        const path = parsePath(relPath);
                        return {
                            name: joinPath(path.dir, path.name),
                            ext: path.ext,
                            outFile: joinPath(val.outRoot, relPath),
                            srcFile: file
                        };
                    }
                )
            )
        ));
    }

    private filterChanged(compilation: wp.Compilation, files: File[]) {
        const changedOrAdded = _.keys(compilation.fileTimestamps).filter(file => {
            if (!_.includes(this.fileDependencies, file)) {
                return false;
            }

            return (this.prevTimestamps[file] || this.startTime) < (compilation.fileTimestamps[file] || Infinity);
        });
    }

    private classifyFiles(files: File[]): bb<FilesByType> {
        debug("classify collected files by mime-type");
        return bb.map(
            files,
            file => statAsync(file.srcFile)
                .then<File & { cat: string }>(fileStat => {
                    if (fileStat == null) {
                        return;
                    }
                    if (fileStat.isDirectory()) {
                        return {
                            cat: "dir",
                            ...file
                        };
                    }

                    const mime = lookup(file.ext);
                    if (mime === false) {
                        return;
                    }

                    let cat = mime.split("/")[0];
                    if (cat === "application") {
                        cat = mime.split("/")[1];
                    }

                    return {
                        cat,
                        ...file
                    };
                })
        ).then(cat_files => {
            const groups = _.groupBy(cat_files, file => file.cat);
            if (groups["dir"]) {
                for (const file of groups["dir"]) {
                    if (!_.includes(this.contextDependencies, file.srcFile)) {
                        this.newContextDependencies.push(file.srcFile);
                    }
                }
                delete groups["dir"];
            }
            const fileByType: FilesByType = {};
            for (const cat of _.keys(groups)) {
                for (const file of groups[cat]) {
                    if (!_.includes(this.fileDependencies, file.srcFile)) {
                        this.newFileDependencies.push(file.srcFile);
                    }

                    if (fileByType[cat] === undefined) {
                        fileByType[cat] = {};
                    }

                    fileByType[cat][file.name] = file;
                }
            }

            return fileByType;
        });
    }
}
