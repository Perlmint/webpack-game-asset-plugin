import * as wp from "webpack";
import * as nsg from "node-sprite-generator";
import * as _glob from "glob";
import * as bb from "bluebird";
import * as _ from "lodash";
import { lookup, types } from "mime-types";
import { v4 as uuidV4 } from "uuid";
import { isAbsolute } from "path";
import { formatPath, joinPath, normalizePath, readFileAsync, relativePath, statAsync, debug, parsePath, localJoinPath } from "./util";
import { InternalOption, GameAssetPluginOption, publicOptionToprivate, File, FilesByType, Assets, isCustomAsset } from "./option";
import { processImages } from "./processImages";
import { processJson } from "./processJson";
import { generateEntry } from "./entryGenerator";
import { processFonts } from "./processFont";

// for shader
types["frag"] = "application/shader";

/**
 * @hidden
 */
const glob = bb.promisify<string[], string, _glob.IOptions>(_glob);

export default class GameAssetPlugin implements wp.Plugin {
    private option: InternalOption;
    private context: string;
    private publicPath: string;
    private entryName: string;
    private fileDependencies: string[] = [];
    private newFileDependencies: string[] = [];
    private contextDependencies: string[] = [];
    private newContextDependencies: string[] = [];
    private startTime: number;
    private prevTimestamps: {[key: string]: number} = {};
    private configFiles: string[] = [];

    constructor(option: GameAssetPluginOption) {
        this.newFileDependencies.push(option.entryOption);
        if (option.entryOption) {
            this.configFiles.push(option.entryOption);
        }
        if (typeof option.atlasMap === "string") {
            this.configFiles.push(option.atlasMap);
        }
        if (option.fonts) {
            this.configFiles.push(option.fonts);
        }
        this.option = publicOptionToprivate(option);
        this.startTime = Date.now();
    }

    private toAbsPath(path: string) {
        if (isAbsolute(path)) {
            return path;
        }

        return localJoinPath(this.context, path);
    }

    private emit(compiler: wp.Compiler, compilation: wp.Compilation, callback: (err?: Error) => void) {
        this.collectFiles()
            .then(files => this.classifyFiles(files))
            .then(fileByType => this.processAssets(compilation, fileByType))
            .then(fileByType => this.generateList(compilation, fileByType))
            .then(() => this.generateEntry(compilation))
            .then(() => callback())
            .catch(e => {
                debug("Error occured while emitting");
                callback(e);
            });
    }

    private afterEmit(compilation: wp.Compilation, callback: (err?: Error) => void) {
        debug(`added ${this.newFileDependencies.length} file dependencies`);
        this.newFileDependencies.push(...this.configFiles);
        this.newFileDependencies = this.newFileDependencies.map(p => this.toAbsPath(p));
        debug(this.newFileDependencies[0]);
        compilation.fileDependencies.push(...this.newFileDependencies);
        this.fileDependencies.push(...this.newFileDependencies);
        debug(compilation.fileDependencies.length);
        debug(`added ${this.newContextDependencies.length} context dependencies`);
        this.newContextDependencies = this.newContextDependencies.map(p => this.toAbsPath(p));
        compilation.contextDependencies.push(...this.newContextDependencies);
        this.contextDependencies.push(...this.newContextDependencies);
        this.newContextDependencies = [];
        this.newFileDependencies = [];

        this.prevTimestamps = compilation.fileTimestamps;
        callback();
    }

    apply(compiler: wp.Compiler) {
        this.context = compiler.options.context;
        this.publicPath = compiler.options.output.publicPath;
        if (this.publicPath != null) {
            if (_.last(this.publicPath) !== "/") {
                this.publicPath += "/";
            }
        }
        else {
            this.publicPath = "";
        }
        this.newFileDependencies = _.map(this.newFileDependencies, path => this.toAbsPath(path));
        this.entryName = compiler.options.output.filename;
        compiler.plugin("emit", this.emit.bind(this, compiler));
        compiler.plugin("after-emit", this.afterEmit.bind(this));
    }

    private processAssets(compilation: wp.Compilation, fileByType: FilesByType) {
        debug("begin process assets");
        return processImages(
            this.context, this.option, compilation, [fileByType, _.cloneDeep(fileByType)]
        ).then(
            files => processJson(this.context, this.option.mergeJson, compilation, files)
        ).then(
            files => processFonts(this.context, this.option, compilation, files)
        ).then(
            files => bb.map(
                _.flatten(
                    _.map(
                        files[0],
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
            ).then(() => files[1])
        );
    }

    private generateList(compilation: wp.Compilation, fileByType: Assets) {
        debug("begin generate list");
        const listData = JSON.stringify(
            _.fromPairs(
                _.map(
                    fileByType,
                    (a, ak) => [
                        ak,
                        _.fromPairs(_.map(a, (v, k) => [k, isCustomAsset(v) ? v.args : v.outFile]))
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
            const groups = _.groupBy(_.filter(cat_files), file => file.cat);
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

    private generateEntry(compilation: wp.Compilation) {
        return this.option.entryOption().then(
            option => generateEntry(this.publicPath, this.entryName , option)
        ).then(files => {
            _.forEach(files, (content, name) => {
                compilation.assets[name] = {
                    size: () => content.length,
                    source: () => content
                };
            });
        });
    }
}
