import * as wp from "webpack";
import * as _glob from "glob";
import * as bb from "bluebird";
import * as _ from "lodash";
import { lookup, types } from "mime-types";
import { isAbsolute, extname, dirname, relative as localRelativePath, parse, join } from "path";
import { joinPath, normalizePath, readFileAsync, relativePath, statAsync, debug, parsePath, localJoinPath, collectDependentAssets, getFileHash, isExists, getLocalizedPath } from "./util";
import { InternalOption, GameAssetPluginOption, publicOptionToprivate, File, FilesByType, Assets, isCustomAsset, ProcessContext, Compilation } from "./option";
import { generateEntry } from "./entryGenerator";
import * as jsonpath from "jsonpath";
import * as it from 'iter-tools';
import * as VirtualModulesPlugin from 'webpack-virtual-modules';

import { Hook } from "tapable";
import { isAssetModule } from "./webpack_util";

type ExtractHookArgs<T> = T extends Hook<infer A, unknown, unknown> ? A : never;

type CompilcationHookArgs = ExtractHookArgs<wp.Compiler['hooks']['compilation']>;

if (Promise !== bb as any) {
    Promise = bb as any;
}

// for shader
types["frag"] = "application/shader";
types["fnt"] = "font";

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

export default class GameAssetPlugin implements ProcessContext {
    static readonly TAP_NAME = "GameAssetPlugin";
    public option: InternalOption;
    /**
     * @hidden
     */
    public context: string;
    private fileDependencies: string[] = [];
    private newFileDependencies: string[] = [];
    private contextDependencies: string[] = [];
    private newContextDependencies: string[] = [];
    private prevTimestamps: Map<string, number> = new Map();
    private configFiles: string[] = [];
    /**
     * @hidden
     */
    public cache: { [key: string]: any } = {};
    public static loaderPath = localJoinPath(__dirname, "assetLoader.js");
    private virtual_module_plugin = new VirtualModulesPlugin();
    private virtual_module_paths: Map<string, string[]> = new Map();

    constructor(option: GameAssetPluginOption) {
        if (option.entryOption) {
            this.configFiles.push(option.entryOption);
        }
        if (typeof option.atlasMap === "string") {
            this.configFiles.push(option.atlasMap);
        }
        this.option = publicOptionToprivate(option);
    }

    public toAbsPath(path: string) {
        if (isAbsolute(path)) {
            return path;
        }

        return localJoinPath(this.context, path);
    }

    private assetCache: Map<string, File> = new Map();
    private refAssetCache: { [key: string]: File[] } = {};

    private async emit(compilation: Compilation): Promise<void> {
        let files: File[];
        if (!this.option.collectAll) {
            files = await this.collectAssetFromModule(compilation);
        }
        else {
            files = await this.collectFiles();
        }
        await this.collectLocalized(files);
        const assetsByModule = await this.identifyAssetReferencedModules(compilation);
        const fileByType = await this.classifyFiles(files);
        const assets = await this.processAssets(compilation, fileByType);
        await this.generateListForModule(compilation, assetsByModule);
        if (this.option.emitAllAssetsList) {
            await this.generateList(compilation, assets);
        }
        await this.generateEntry(compilation);
    }

    private async afterEmit(compilation: wp.Compilation): Promise<void> {
        debug(`added ${this.newFileDependencies.length} file dependencies`);
        this.newFileDependencies.push(...this.configFiles);
        await bb.all(this.newFileDependencies.map((file) => new Promise((resolve, reject) => compilation.fileSystemInfo.getFileTimestamp(file, (e, info) => {
            if (e != null || typeof info !== "object") {
                reject(e);
            } else {
                this.prevTimestamps.set(file, info.safeTime);
                resolve();
            }
        })))).catch(() => { /* */ });
        this.newFileDependencies = this.newFileDependencies.map(p => this.toAbsPath(p));
        debug(this.newFileDependencies[0]);
        compilation.fileDependencies.addAll(this.newFileDependencies);
        this.fileDependencies = this.newFileDependencies;
        debug(compilation.fileDependencies.size);
        debug(`added ${this.newContextDependencies.length} context dependencies`);
        this.newContextDependencies = this.newContextDependencies.map(p => this.toAbsPath(p));
        compilation.contextDependencies.addAll(this.newContextDependencies);
        this.contextDependencies = this.newContextDependencies;
        this.newContextDependencies = [];
        this.newFileDependencies = [];
    }

    private injectToCompilation(compilation: Compilation, data: CompilcationHookArgs[1]) {
        compilation.__game_asset_plugin_option__ = this.option;
        compilation._game_asset_ = new Map();
        compilation._referenced_modules_ = new Map();

        data.normalModuleFactory.hooks.beforeResolve.tapPromise(GameAssetPlugin.TAP_NAME, async (result) => {
            const game_asset_loader_req = /game-asset-glob(!|\?)/.exec(result.request);
            if (game_asset_loader_req) {
                // handle glob patterns
                const path = result.request.substring(game_asset_loader_req.index + game_asset_loader_req[0].length);
                const glob_result = await glob(path, {
                    root: result.context,
                    cwd: result.context,
                    nocomment: true,
                    nonegate: true,
                    noglobstar: true,
                });

                if (glob_result.length === 0) {
                    // show warning
                    return;
                }

                glob_result.sort();

                const virtual_path = `${path.replace(/\*/g, '_').replace(/([^.])\//g, '$1_')}.js`;
                result.request = virtual_path;
                const deps = this.virtual_module_paths.get(virtual_path);
                // not changed
                if (_.isEqual(deps, glob_result)) {
                    return;
                }

                // TODO: apply other loaders
                let content = 'module.exports = {';
                for (const item of glob_result) {
                    content += `"${parsePath(item).name}": require("game-asset!${item}").default,`;
                }
                content += '};';
                this.virtual_module_plugin.writeModule(join(result.context, virtual_path), content);
                this.virtual_module_paths.set(virtual_path, glob_result);
            } else if (result.request === "webpack-game-asset-plugin/helper") {
                result.request = `game-asset?info=${result.contextInfo.issuer}!${result.contextInfo.issuer}`;
            }
        });
    }

    apply(compiler: wp.Compiler) {
        // inject game-asset loader
        if (compiler.options.resolveLoader.alias != null) {
            if (Array.isArray(compiler.options.resolveLoader.alias)) {
                compiler.options.resolveLoader.alias.push({
                    alias: 'game-asset',
                    name: GameAssetPlugin.loaderPath,
                });
            } else {
                compiler.options.resolveLoader.alias['game-asset'] = GameAssetPlugin.loaderPath;
            }
        } else {
            compiler.options.resolveLoader.alias = {
                'game-asset': GameAssetPlugin.loaderPath,
            };
        }
        if (compiler.options.plugins.indexOf(this.virtual_module_plugin) === -1) {
            compiler.options.plugins.push(this.virtual_module_plugin);
        }
        this.context = compiler.options.context;
        this.newFileDependencies = _.map(this.newFileDependencies, path => this.toAbsPath(path));
        compiler.hooks.compilation.tap(GameAssetPlugin.TAP_NAME, this.injectToCompilation.bind(this));
        compiler.hooks.emit.tapPromise(GameAssetPlugin.TAP_NAME, this.emit.bind(this));
        compiler.hooks.afterEmit.tapPromise(GameAssetPlugin.TAP_NAME, this.afterEmit.bind(this));
    }

    private async processAssets(compilation: Compilation, fileByType: FilesByType): Promise<Assets> {
        debug("begin process assets");
        let files: [FilesByType, Assets] = [fileByType, Object.assign({}, fileByType)];
        if (this.option.makeAtlas) {
            const { processImages } = await import("./processImages");
            files = await processImages(
                this, compilation, this.option, files
            );
        }
        if (this.option.mergeJson) {
            const { processJson } = await import("./processJson");
            files = await processJson(this, compilation, files);
        }
        if (files[0]["font"]) {
            const { processFonts } = await import("./processFont");
            files = await processFonts(this, compilation, files);
        }
        if (this.option.audioSprite || this.option.audioEncode) {
            const { processAudio } = await import("./processAudio");
            files = await processAudio(this, compilation, files);
        }
        const copies = _.flatten(
            _.map(
                files[0],
                byType => _.values(byType)
            )
        );

        let copied = 0;
        for (const copy of copies) {
            if (!await this.isChanged(compilation, copy.srcFile)) {
                continue;
            }
            copied++;
            if (typeof copy.outFile !== "string") {
                // something really wrong
                continue;
            }

            if (copy.data != null) {
                // generated just copy it
                compilation.emitAsset(copy.outFile, new wp.sources.RawSource(copy.data, false));
            } else {
                for (const lng of copy.localized) {
                    const content = await readFileAsync(getLocalizedPath(copy.srcFile, lng));

                    compilation.emitAsset(getLocalizedPath(copy.outFile, lng), new wp.sources.RawSource(content, false));
                }
            }
        }
        debug(`${copied} items are copied`);

        return files[1];
    }

    private generateList(compilation: Compilation, fileByType: Assets) {
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
        compilation.emitAsset(this.option.listOut, new wp.sources.RawSource(listData, true));
        return bb.resolve();
    }

    private referencedModules: Map<string, wp.NormalModule> = new Map();
    private cachedAssets: { [key: string]: File[] } = {};
    private async generateListForModule(compilation: Compilation, assetsForModule: Map<string, string[]>) {
        for (const [hash, module] of this.referencedModules.entries()) {
            assetsForModule.set(module.resource, []);
            const assets: string[] = collectDependentAssets(compilation, this.referencedModules, module, assetsForModule, GameAssetPlugin.loaderPath);
            const assetsInfo: File[] = _.sortBy(_.filter(_.uniq(_.concat(
                this.refAssetCache[module.resource],
                assets.map(asset => this.assetCache.get(asset)),
                _.flatten(assets.map(asset => _.defaultTo(this.refAssetCache[asset], [])))))), f => f.srcFile);
            const assetsJson: { [key: string]: { [key: string]: string[] } } = {};
            let isChanged = !_.isEqual(this.cachedAssets[module.id] || [], assetsInfo);
            for (const asset of assetsInfo) {
                if (!isChanged && await this.isChanged(compilation, asset.srcFile)) {
                    isChanged = true;
                }
                if (assetsJson[asset.outType] === undefined) {
                    assetsJson[asset.outType] = {};
                }
                assetsJson[asset.outType][_.defaultTo(asset.outName, asset.name)] = typeof asset.outFile === "string" ? [asset.outFile] : asset.outFile;
            }

            this.cachedAssets[module.id] = assetsInfo;
            const contentStr = JSON.stringify(assetsJson);
            compilation.emitAsset(hash + ".json", new wp.sources.RawSource(contentStr, true));
        }
    }

    private async identifyAssetReferencedModules(compilation: Compilation) {
        const assetsForModule: Map<string, string[]> = new Map();
        const modules = it.flatMap(chunk => compilation.chunkGraph.getChunkModules(chunk), compilation.chunks.values());
        for (const [hash, module] of compilation._referenced_modules_) {
            this.referencedModules.set(hash, module);
        }
        const removedModuleHash: string[] = [];
        for (const [hash, module] of this.referencedModules) {
            if (!it.includes(module, modules)) {
                removedModuleHash.push(hash);
                return;
            }
            assetsForModule.set(module.resource, []);
            const assets: string[] = collectDependentAssets(
                compilation, this.referencedModules, module, assetsForModule, GameAssetPlugin.loaderPath
            );
            const assetsInfo = _.filter(_.uniq(_.concat(
                this.refAssetCache[module.resource],
                assets.map(asset => this.assetCache.get(asset)),
                _.flatten(assets.map(asset => _.defaultTo(this.refAssetCache[asset], []))))));
            for (const asset of assetsInfo) {
                if (asset.referencedModules === undefined) {
                    asset.referencedModules = [];
                }
                if (asset.referencedModules.indexOf(module.resource) === -1) {
                    asset.referencedModules.push(module.resource);
                }
            }
        }

        for (const hash of removedModuleHash) {
            this.referencedModules.delete(hash);
        }

        compilation._referenced_modules_ = new Map();

        return assetsForModule;
    }

    private async collectAssetFromModule(compilation: Compilation) {
        const assets = new Map(compilation._game_asset_ ?? undefined);
        compilation.chunks.forEach((chunk) => {
            for (const module of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
                if (!isAssetModule(module)) {
                    continue;
                }
                if (!this.assetCache.has(module.resource)) {
                    continue;
                }

                assets.set(module.resource, this.assetCache.get(module.resource));
            }
        });
        const files = await this.extendFiles(compilation, assets);
        for (const file of files) {
            this.assetCache.set(this.toAbsPath(file.srcFile), file);
        }

        return files;
    }

    private async collectFiles(): Promise<File[]> {
        debug("collect assets");
        const ret = bb.map(this.option.assetRoots, async (root) => {
            const { src: srcRoot, out: outRoot } = root;
            const items = await glob(srcRoot + "/**/*", {
                ignore: this.option.excludes
            });

            return bb.map(
                items,
                async file => {
                    file = normalizePath(file);
                    const relPath = relativePath(srcRoot, file);
                    const path = parsePath(relPath);
                    return {
                        name: joinPath(path.dir, path.name),
                        ext: path.ext,
                        outFile: joinPath(outRoot, relPath),
                        srcFile: file,
                        hash: (await getFileHash("md5", file)).digest("hex"),
                        localized: [""]
                    } as File;
                }
            );
        });

        return _.flatten(await bb.all(ret));
    }

    private async collectLocalized(files: File[]) {
        return bb.map(files, file => {
            const parsedPath = parse(file.srcFile);
            return bb.map(this.option.i18nLanguages, async lng => {
                const localizedPath = getLocalizedPath(parsedPath, lng);
                if (await isExists(localizedPath)) {
                    file.localized.push(lng);
                }
            });
        }).thenReturn(files);
    }

    private filterChanged(files: File[]) {
        // const changedOrAdded = _.keys(this.compilation.fileTimestamps).filter(file => {
        //     if (!_.includes(this.fileDependencies, file)) {
        //         return false;
        //     }

        //     return this.isChanged(file);
        // });
    }

    public isChanged(compilation: Compilation, file: string): Promise<boolean> {
        file = this.toAbsPath(file);
        const prevTimestamp = this.prevTimestamps.get(file) || -Infinity;
        return new Promise((resolve, reject) => compilation.fileSystemInfo.getFileTimestamp(file, (e, info) => {
            if (e != null || typeof info !== "object") {
                reject(e);
            } else {
                resolve(prevTimestamp < info.safeTime);
            }
        }));
    }

    private async extendFiles(compilation: Compilation, allFiles: Map<string, File>): Promise<File[]> {
        const files = [...allFiles.entries()];
        for (const [key, file] of files) {
            if (!await this.isChanged(compilation, file.srcFile)) {
                if (this.refAssetCache[key]) {
                    for (const refFile of this.refAssetCache[key]) {
                        allFiles.set(refFile.name, refFile);
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
                if (file.query["async"]) {
                    this.refAssetCache[key].push(file);
                }

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
                            const outFile = localRelativePath(this.context, srcFile).replace(/\\/g, "/");
                            const ext = extname(outFile);
                            const name = _.clone(outFile);
                            parent[lastComponent] = name;
                            const hash = await getFileHash("md5", srcFile);
                            if (!allFiles.has(srcFile)) {
                                allFiles.set(srcFile, {
                                    name,
                                    ext,
                                    hash: hash.digest("hex"),
                                    srcFile,
                                    outFile,
                                    query: {},
                                    localized: [""]
                                });
                            }

                            this.refAssetCache[key].push(allFiles.get(srcFile));
                        }
                    }
                    catch (e) {
                        throw new Error(`Error occured while precessing ${key} ${(e as Error).stack}`);
                    }

                    file.data = JSON.stringify(data);
                }
            }
        }

        return [...allFiles.values()];
    }

    private async classifyFiles(files: File[]): Promise<FilesByType> {
        debug("classify collected files by mime-type");
        const cat_files = await bb.map(
            files,
            file => statAsync(file.srcFile)
                .then<File & { cat: string }>(fileStat => {
                    if (fileStat == null) {
                        return;
                    }
                    if (fileStat.isDirectory()) {
                        return Object.assign(file, {
                            cat: "dir"
                        });
                    }

                    const mime = lookup(file.ext);
                    if (mime === false) {
                        return;
                    }

                    let cat = mime.split("/")[0];
                    if (cat === "application") {
                        cat = mime.split("/")[1];
                    }
                    file.type = cat;
                    if (file.outType === undefined) {
                        file.outType = cat;
                    }

                    return Object.assign(file, {
                        cat
                    });
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
                if (!_.includes(this.newFileDependencies, file.srcFile)) {
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

    private async generateEntry(compilation: Compilation): Promise<void> {
        const entrypoints = [...it.flatMap(([,entrypoint]) => _.map(entrypoint.chunks, (chunk: wp.Chunk) => {
            const filenameTemplate = chunk.filenameTemplate ? chunk.filenameTemplate :
                chunk.isOnlyInitial() ? compilation.outputOptions.filename :
                compilation.outputOptions.chunkFilename;
            const useChunkHash = !chunk.hasRuntime();
            const path = compilation.getPath(filenameTemplate, {
                noChunkHash: !useChunkHash,
                chunk
            });
            return path;
        }), compilation.entrypoints)];

        let publicPath = compilation.outputOptions.publicPath;
        let useHash = false;
        if (publicPath != null && typeof publicPath === 'string') {
            if (_.last(publicPath) !== "/") {
                publicPath += "/";
            }
            useHash = publicPath.indexOf("[hash]") != -1;
        } else {
            publicPath = "";
        }
        publicPath = publicPath.replace("[hash]", compilation.hash);
        const option = await this.option.entryOption(this.context);
        const deps = [option._path];

        if (option.icon) {
            this.newFileDependencies.push(option.icon);
            deps.push(option.icon);
        }

        if (option.offline && option.offline.image) {
            this.newFileDependencies.push(option.offline.image);
            deps.push(option.offline.image);
        }

        if (!useHash && !_.some(deps, d => this.isChanged(compilation, d))) {
            return;
        }

        const files = await generateEntry(publicPath, entrypoints, compilation.hash, option);

        _.forEach(files, (content, name) => {
            compilation.emitAsset(name, new wp.sources.RawSource(content, false));
        });
    }
}
