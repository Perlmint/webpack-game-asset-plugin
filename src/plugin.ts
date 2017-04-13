import * as wp from "webpack";
import * as nsg from "node-sprite-generator";
import * as _glob from "glob";
import * as bb from "bluebird";
import * as _ from "lodash";
import * as mt from "mime-types";
import { createWriteStream, stat, readFile } from "fs";
import { isAbsolute, parse as parsePath, posix } from "path";
const readFileAsync = bb.promisify(readFile);
const statAsync = bb.promisify(stat);
const relativePath = posix.relative;
const formatPath = posix.format;
const joinPath = posix.join;
const normalizePath = posix.normalize;

const glob = bb.promisify<string[], string, _glob.IOptions>(_glob);

function debug(text: string) {
    console.log("[webpack-game-asset-plugin] " + text);
}

interface File {
    name: string;
    ext: string;
    outFile: string;
    srcFile: string;
};
type FilesByType = {[key: string]: {[key: string]: File}};

export interface GameAssetPluginOption {
    makeAtlas?: boolean;
    assetRoots: (string | [string, string])[];
    excludes?: string[];
    listOut: string;
};

export default class GameAssetPlugin implements wp.Plugin {
    private option: GameAssetPluginOption;
    private fileDependencies: string[] = [];
    private newFileDependencies: string[] = [];
    private contextDependencies: string[] = [];
    private newContextDependencies: string[] = [];

    constructor(option: GameAssetPluginOption) {
        this.option = option;
    }

    private emit(compiler: wp.Compiler, compilation: wp.Compilation, callback: () => void) {
        this.collectFiles()
            .then(files => this.classifyFiles(files))
            .then(fileByType => this.processAssets(compilation, fileByType)
                  .then(() => this.generateList(compilation, fileByType)))
            .then(callback);
    }

    private afterEmit(compilation: wp.Compilation, callback: () => void) {
        compilation.fileDependencies.push(...this.newFileDependencies);
        this.fileDependencies.push(...this.newFileDependencies);
        compilation.contextDependencies.push(...this.newContextDependencies);
        this.contextDependencies.push(...this.newContextDependencies);
        this.newContextDependencies = [];
        this.newFileDependencies = [];
    }

    apply(compiler: wp.Compiler) {
        compiler.plugin("emit", this.emit.bind(this, compiler));
        compiler.plugin("afet-emit", this.afterEmit.bind(this));
    }

    private processAssets(compilation: wp.Compilation, fileByType: FilesByType) {
        debug("begin process assets");
        if (this.option.makeAtlas === true) {
            return new bb((resolve, reject) => {
                nsg({
                    src: _.map(fileByType["image"], file => file.srcFile)
                }, e => {
                    if (e == null) {
                        resolve();
                    } else {
                        reject(e);
                    }
                });
            });
        } else {
            return bb.map(_.flatten(_.map(fileByType, byType => _.values(byType))), file => readFileAsync(file.srcFile).then(content => {
                compilation.assets[file.outFile] = {
                    size: () => content.length,
                    source: () => content
                };
            }));
        }
    }

    private generateList(compilation: wp.Compilation, fileByType: FilesByType) {
        debug("begin generate list");
        return new bb(resolve => {
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
            resolve();
        });
    }

    private collectFiles() {
        return bb.map(this.option.assetRoots, root => {
            let srcRoot: string, outRoot: string;
            if (Array.isArray(root)) {
                [srcRoot, outRoot] = root;
            } else {
                [srcRoot, outRoot] = [root, root];
            }
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
            filesByRoot.map(
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

    private classifyFiles(files: File[]) {
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

                    const mime = mt.lookup(file.ext);
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
