import * as nsg from "node-sprite-generator";
import * as bb from "bluebird";
import * as _ from "lodash";
import * as wp from "webpack";
import { join, isAbsolute } from "path";
import { Fontdeck, Google, Monotype, Typekit, Custom as CustomWebFont } from "webfontloader";
import { readFileAsync } from "./util";
import { EntryOption } from "./entryGenerator";

/**
 * @hidden
 */
export interface File {
    name: string;
    ext: string;
    outFile: string | string[];
    srcFile: string;
    localized: string[];
    referencedModules?: string[];
    hash: string;
    data?: string;
    type?: string;
    outType?: string;
    outName?: string;
    query?: {[key: string]: string};
}

/**
 * @hidden
 */
export function isFile(f: any): f is File {
    return f.name !== undefined && f.srcFile !== undefined;
}

/**
 * @hidden
 */
export interface Module {
    context: string;
    userRequest?: string;
    resource: string;
    loaders: {
        loader: string
    }[];
}

/**
 * @hidden
 */
export type Compilation = wp.Compilation & {
    _game_asset_: Map<string, File>;
    _referenced_modules_: Map<string, wp.NormalModule>;
    __game_asset_plugin_option__: InternalOption,
};

/**
 * @hidden
 */
export type FilesByType = {[key: string]: {[key: string]: File}};
export type CustomAsset = { args: any };
export type Assets = {[key: string]: {[key: string]: File | CustomAsset }};
/**
 * @hidden
 */
export function isCustomAsset(asset: File | CustomAsset): asset is CustomAsset  {
    return (<CustomAsset>asset).args !== undefined;
}

/**
 * @hidden
 */
export type PackType = {
    name: string;
    group: number;
};

/**
 * @hidden
 */
export type AtlasMapType = {
    [group: string]: string[];
};

/**
 * Atlas group definition
 *
 * - each element makes group.
 * - each string value means prefix of image.
 *   - e.g. asset/game/enemy/small_1.png can be involved in asset/game/enemy/small_ asset/game/enemy, asset/game, asset
 *   - each image will be contained into most longest matched prefix.
 * - `!` prefix means exclude from group, does not packed into atlas. It will be emitted as is.
 */
export type AtlasGroupDefinition = (string | string[])[];

export interface GameAssetPluginOption {
    entry: string | string[],
    /**
     * whether make sprite atls
     * @default false
     */
    makeAtlas?: boolean;
    /**
     * define atlas groups
     *
     * when string is passed, assume it as file path which contains definition in JSON format.
     *
     * [[AtlasGroupDefinition]] is passed, just use it as is.
     */
    atlasMap?: string | AtlasMapType;
    /**
     * Roots where collect assets from
     *
     * single string element menas just path to collect assets.
     * by using `[string, string]`, you can specify out directory for assets.
     * first element should be path, second element is output directory name.
     */
    assetRoots: (string | [string, string])[];
    /**
     * exclude rules for collecting assets.
     */
    excludes?: string[];
    /**
     * collected list webpack output path.
     */
    listOut: string;
    /**
     * compositor to used for making sprite atlas.
     */
    compositor?: nsg.Compositor;
    /**
     * sprite atlas padding
     *
     * @default 0
     */
    padding?: number;
    /**
     * sprite atlas max width
     *
     * @default 2048
     */
    maxWidth?: number;
    /**
     * sprite atlas max height
     *
     * @default 2048
     */
    maxHeight?: number;
    /**
     * Path of file containing generating entry html option
     *
     * @see [[EntryOption]]
     */
    entryOption: string;
    /**
     * Merge json files into single json file
     *
     * @default false
     */
    mergeJson?: boolean;
    /**
     * Create audio sprite
     *
     * @default false
     */
    audioSprite?: boolean;
    /**
     * game-asset loader reference preset
     *
     * { [name]: JSONPath } object
     */
    refPresets?: { [key: string]: string };
    /**
     * collect assets from prefixed root
     */
    collectAll: boolean;
    /**
     * emit list of all collected assets
     *
     * @default false
     */
    emitAllAssetsList?: boolean;
    /**
     * encode audio to these codecs
     */
    audioEncode?: AudioCodec[];
    /**
     * i18n resource postfix list
     */
    i18nLanguages?: string[];
    /**
     * add file hash to emitted asset filename
     */
    addHashToAsset?: boolean;
}

export type AudioCodec = "ogg" | "m4a" | "mp3" | "ac3";

/**
 * Webfont config - see [webfontloader](https://www.npmjs.com/package/webfontloader)
 *
 * one of custom / google / typekit / fontdeck / monotype should be set
 */
export interface WebFontConf {
    type: "WEBFONT";
    custom?: CustomWebFont;
    google?: Google;
    typekit?: Typekit;
    fontdeck?: Fontdeck;
    monotype?: Monotype;
}
/**
 * file file path - `.ttf` file or `.fnt` file
 */
export type LocalFontConf = string;
/**
 * Bitmap generation option
 */
export interface BitmapFontConf {
    type: "BITMAP";
    /**
     * Font name
     */
    font: string;
    /**
     * Font size in px
     */
    size: number;
    /**
     * Font fill color
     */
    fill: string;
    /**
     * Font weight
     * @default 400(normal)
     */
    weight: number;
    /**
     * characters to render
     */
    characters: string;
    /**
     * outline stroke option
     */
    stroke?: {
        /**
         * stroke thickness in px
         */
        thickness: number;
        /**
         * stroke color
         */
        color: string;
    };
    /**
     * Font shadow
     */
    shadow?: {
        /**
         * shadow color
         */
        color: string;
        /**
         * shadow angle
         */
        angle: number;
        /**
         * shadow distance from center
         */
        distance: number;
    };
    /**
     * margin for each characters
     */
    gap: number;
}

/**
 * @hidden
 */
export function isBitmap(conf: WebFontConf | BitmapFontConf): conf is BitmapFontConf {
    return conf.type === "BITMAP";
}

export type Fonts = {[key: string]: (WebFontConf | BitmapFontConf | LocalFontConf)};

/**
 * @hidden
 */
export interface InternalOption {
    makeAtlas: boolean;
    audioSprite: boolean;
    atlasMap: (context: string) => bb<AtlasMapType>;
    atlasMapFile?: string;
    assetRoots: {
        src: string;
        out: string
    }[];
    excludes: string[];
    listOut: string;
    compositor?: nsg.Compositor;
    atlasOption: {
        padding: number;
        width: number;
        height: number;
    };
    entryOption(context: string): bb<EntryOption>;
    mergeJson: boolean;
    refPresets: { [key: string]: string };
    collectAll: boolean;
    emitAllAssetsList: boolean;
    audioEncode: string[];
    i18nLanguages: string[];
    addHashToAsset: boolean;
}

/**
 * @hidden
 */
export function publicOptionToprivate(pubOption: GameAssetPluginOption) {
    let atlasMapFunc: (context: string) => bb<AtlasMapType> = () => bb.resolve<AtlasMapType>({});
    const atlasMap = pubOption.atlasMap;
    let atlasMapFile: string = undefined;
    if (typeof atlasMap === "string") {
        atlasMapFunc = (context: string) => readFileAsync(
            join(context, atlasMap)
        ).then(
            buf => JSON.parse(buf.toString("utf-8")) as AtlasMapType
        );
        atlasMapFile = atlasMap;
    } else if (atlasMap != null) {
        atlasMapFunc = () => bb.resolve(atlasMap);
    }
    return {
        atlasMap: atlasMapFunc,
        atlasMapFile: atlasMapFile,
        makeAtlas: pubOption.makeAtlas || false,
        assetRoots: _.map(pubOption.assetRoots, root => {
            let srcRoot: string, outRoot: string;
            if (Array.isArray(root)) {
                return {
                    src: root[0],
                    out: root[1]
                };
            } else {
                return {
                    src: root,
                    out: root
                };
            }
        }),
        excludes: pubOption.excludes || [],
        listOut: pubOption.listOut,
        compositor: pubOption.compositor,
        atlasOption: {
            padding: pubOption.padding || 0,
            width: pubOption.maxWidth || 2048,
            height: pubOption.maxHeight || 2048
        },
        entryOption(context: string) {
            return readFileAsync(
                isAbsolute(pubOption.entryOption) ? pubOption.entryOption : join(context, pubOption.entryOption)
            ).then(
                buf => _.assign(JSON.parse(buf.toString("utf-8")), { _path: pubOption.entryOption })
            );
        },
        mergeJson: pubOption.mergeJson || false,
        audioSprite: pubOption.audioSprite || false,
        refPresets: pubOption.refPresets || {},
        collectAll: pubOption.collectAll == null ? false : pubOption.collectAll,
        emitAllAssetsList: pubOption.emitAllAssetsList || false,
        audioEncode: pubOption.audioEncode || [],
        i18nLanguages: pubOption.i18nLanguages || [],
        addHashToAsset: pubOption.addHashToAsset || false
    } as InternalOption;
}

/**
 * @hidden
 */
export interface ProcessContext {
    context: string;
    cache: { [key: string]: any };
    option: InternalOption;

    isChanged(compilation: Compilation, file: string): Promise<boolean>;
    toAbsPath(path: string): string;
}
