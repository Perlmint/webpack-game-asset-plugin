import * as wp from "webpack";
import * as nsg from "node-sprite-generator";
import * as _glob from "glob";
import * as bb from "bluebird";
import * as _ from "lodash";
import { lookup, types } from "mime-types";
import { v4 as uuidV4 } from "uuid";
import { isAbsolute, extname, dirname, relative as localRelativePath } from "path";
import { formatPath, joinPath, normalizePath, readFileAsync, relativePath, statAsync, debug, parsePath, localJoinPath } from "./util";
import { InternalOption, GameAssetPluginOption, publicOptionToprivate, File, FilesByType, Assets, isCustomAsset, ProcessContext, Compilation } from "./option";
import { generateEntry } from "./entryGenerator";
import * as jsonpath from "jsonpath";

// for shader
types["frag"] = "application/shader";

/**
 * @hidden
 */
const glob = bb.promisify<string[], string, _glob.IOptions>(_glob);

/**
 * @hidden
 */
interface ParticleJson {
    children?: ParticleJson[];
    image?: string;
}

export default class GameAssetPlugin implements wp.Plugin, ProcessContext {
    private option: InternalOption;
    /**
     * @hidden
     */
    public context: string;
    private publicPath: string;
    private entryName: string;
    private fileDependencies: string[] = [];
    private newFileDependencies: string[] = [];
    private contextDependencies: string[] = [];
    private newContextDependencies: string[] = [];
    private startTime: number;
    private prevTimestamps: {[key: string]: number} = {};
    private configFiles: string[] = [];
    /**
     * @hidden
     */
    public compilation: Compilation = null;
    /**
     * @hidden
     */
    public cache: { [key: string]: any } = {};
    public static loaderPath = localJoinPath(__dirname, "assetLoader.js");

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

    private assetCache: { [key: string]: File } = {};
    private refAssetCache: { [key: string]: File[] } = {};

    private async emit(compiler: wp.Compiler, compilation: Compilation, callback: (err?: Error) => void): bb<void> {
        this.compilation = compilation;
        try {
            let files: File[];
            if (!this.option.collectAll) {
                const assets = _.clone(compilation._game_asset_) || {};
                for (const chunk of compilation.chunks) {
                    for (const module of chunk.modules) {
                        if (module.userRequest && _.find(module.loaders, loader => loader.loader === GameAssetPlugin.loaderPath) != null) {
                            if (this.assetCache[module.resource]) {
                                assets[module.resource] = this.assetCache[module.resource];
                            }
                        }
                    }
                }
                files = await this.extendFiles(assets);
                for (const assetKey of _.keys(assets)) {
                    this.assetCache[assetKey] = assets[assetKey];
                }
            }
            else {
                files = await this.collectFiles();
            }
            const fileByType = await this.classifyFiles(files);
            const assets = await this.processAssets(fileByType);
            await this.generateList(assets);
            await this.generateEntry();
            callback();
        }
        catch (e) {
            debug("Error occured while emitting");
            callback(e);
        }
    }

    private afterEmit(compilation: wp.Compilation, callback: (err?: Error) => void) {
        debug(`added ${this.newFileDependencies.length} file dependencies`);
        this.newFileDependencies.push(...this.configFiles);
        this.newFileDependencies = this.newFileDependencies.map(p => this.toAbsPath(p));
        debug(this.newFileDependencies[0]);
        compilation.fileDependencies.push(...this.newFileDependencies);
        this.fileDependencies = this.newFileDependencies;
        debug(compilation.fileDependencies.length);
        debug(`added ${this.newContextDependencies.length} context dependencies`);
        this.newContextDependencies = this.newContextDependencies.map(p => this.toAbsPath(p));
        compilation.contextDependencies.push(...this.newContextDependencies);
        this.contextDependencies = this.newContextDependencies;
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

    private async processAssets(fileByType: FilesByType): bb<Assets> {
        debug("begin process assets");
        let files: [FilesByType, Assets] = [fileByType, _.cloneDeep(fileByType)];
        if (this.option.makeAtlas) {
            const { processImages } = await import("./processImages");
            files = await processImages(
                this, this.option, files
            );
        }
        if (this.option.mergeJson) {
            const { processJson } = await import("./processJson");
            files = await processJson(this, files);
        }
        const fonts = await this.option.fonts();
        if (fonts != null) {
            const { processFonts } = await import("./processFont");
            files = await processFonts(this, fonts, files);
        }
        if (this.option.audioSprite) {
            const { processAudio } = await import("./processAudio");
            files = await processAudio(this, files);
        }
        const copies = _.flatten(
            _.map(
                files[0],
                byType => _.values(byType)
            )
        );

        let copied = 0;
        for (const copy of copies) {
            if (!this.isChanged(copy.srcFile)) {
                continue;
            }
            copied++;
            const content = copy.data == null ? await readFileAsync(copy.srcFile) : copy.data;
            (typeof copy.outFile === "string" ? [copy.outFile] : copy.outFile).map(
                outFile => this.compilation.assets[outFile] = {
                    size: () => content.length,
                    source: () => content
                }
            );
        }
        debug(`${copied} items are copied`);

        return files[1];
    }

    private generateList(fileByType: Assets) {
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
        this.compilation.assets[this.option.listOut] = {
            size: () => listData.length,
            source: () => listData,
        };
        return bb.resolve();
    }

    private async collectFiles(): bb<File[]> {
        debug("collect assets");
        const filesByRoot = await bb.map(this.option.assetRoots, async (root) => {
            const { src: srcRoot, out: outRoot } = root;
            const items = await glob(srcRoot + "/**/*", {
                ignore: this.option.excludes
            });

            return {
                srcRoot,
                outRoot,
                items
            };
        });
        return _.flatten(
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
        );
    }

    private filterChanged(files: File[]) {
        const changedOrAdded = _.keys(this.compilation.fileTimestamps).filter(file => {
            if (!_.includes(this.fileDependencies, file)) {
                return false;
            }

            return this.isChanged(file);
        });
    }

    public isChanged(file: string) {
        file = this.toAbsPath(file);
        const prevTimestamp = this.prevTimestamps[file] || this.startTime;
        const curTimeStamp = this.compilation.fileTimestamps[file] || Infinity;
        return prevTimestamp < curTimeStamp;
    }

    private async extendFiles(allFiles: {[key: string]: File}): bb<File[]> {
        const files = _.toPairs(allFiles);
        for (const kv of files)
        {
            const [key, file] = kv;
            if (!this.isChanged(file.srcFile)) {
                if (this.refAssetCache[key]) {
                    for (const refFile of this.refAssetCache[key]) {
                        allFiles[refFile.name] = refFile;
                    }
                }
                continue;
            }

            const fileDir = dirname(file.srcFile);
            if (file.ext === ".json") {
                let ref: string = null;
                if (file.query["pre"]) {
                    ref = this.option.refPresets[file.query["pre"]];
                }
                if (file.query["ref"]) {
                    ref = file.query["ref"];
                }
                this.refAssetCache[key] = [];

                if (ref !== null) {
                    const buf = await readFileAsync(file.srcFile);
                    const data = JSON.parse(buf.toString("utf-8"));
                    try {
                        const paths = jsonpath.paths(data, ref);
                        for (const path of paths) {
                            let ptr = data;
                            let parent = null;
                            for (const component of path) {
                                if (component === "$") {
                                    ptr = data;
                                    parent = null;
                                }
                                else {
                                    parent = ptr;
                                    ptr = ptr[component];
                                }
                            }

                            const lastComponent = _.last(path);
                            const srcFile = localJoinPath(fileDir, ptr);
                            const name = localRelativePath(this.context, srcFile).replace(/\\/g, "/");
                            parent[lastComponent] = name;
                            if (allFiles[name] === undefined) {
                                allFiles[name] = {
                                    name,
                                    ext: extname(parent[lastComponent]),
                                    srcFile,
                                    outFile: name
                                };
                            }

                            this.refAssetCache[key].push(allFiles[name]);
                        }
                    }
                    catch (e) {
                        throw new Error(`Error occured while precessing ${key} ${(e as Error).stack}`);
                    }

                    file.data = JSON.stringify(data);
                }
            }
        }

        return _.values(allFiles);
    }

    private async classifyFiles(files: File[]): bb<FilesByType> {
        debug("classify collected files by mime-type");
        const cat_files = await bb.map(
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
        );
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
    }

    private async generateEntry(): bb<void> {
        const option = await this.option.entryOption();
        const deps = [option._path];

        if (option.icon) {
            this.newFileDependencies.push(option.icon);
            deps.push(option.icon);
        }

        if (option.offline && option.offline.image) {
            this.newFileDependencies.push(option.offline.image);
            deps.push(option.offline.image);
        }

        if (!_.some(deps, d => this.isChanged(d))) {
            return;
        }

        const files = await generateEntry(this.publicPath, this.entryName , option);

        _.forEach(files, (content, name) => {
            this.compilation.assets[name] = {
                size: () => content.length,
                source: () => content
            };
        });
    }
}
