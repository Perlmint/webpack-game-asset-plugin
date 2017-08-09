import * as nsg from "node-sprite-generator";
import * as bb from "bluebird";
import * as _ from "lodash";
import * as wp from "webpack";
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
    data?: string;
    type?: string;
    outType?: string;
    query?: {[key: string]: string};
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
    _game_asset_: {
        [key: string]: File
    };
    _referenced_modules_: {
        [key: string]: string[]
    };
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
    excludes: string[];
    pack: PackType[]
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
    atlasMap?: string | AtlasGroupDefinition;
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
    collectAll: boolean;

    audioEncode?: AudioCodec[];
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
    atlasMap: () => bb<AtlasMapType>;
    atlasMapFile?: string;
    assetRoots: {
        src: string;
        out: string
    }[];
    excludes: string[];
    listOut: string;
    compositor?: nsg.Compositor;
    atlasOption: {
        padding?: number;
    };
    entryOption(): bb<EntryOption>;
    mergeJson: boolean;
    refPresets: { [key: string]: string };
    collectAll: boolean;
    audioEncode: string[];
}

/**
 * @hidden
 */
function sortAtlasMap(map: (string | string[])[]): AtlasMapType {
    let idx = 1;
    const indexMapped = _.reduce<string | string[], PackType[]>(map, (prev, item) => {
        if (Array.isArray(item)) {
            prev.push(..._.map<string, PackType>(
                _.filter(item, i => _.find(prev, p => p.name === i) == null), i => ({
                    name: i,
                    group: idx
                })));
        } else if (_.find(prev, p => p.name === item) == null) {
            prev.push({
                name: item,
                group: idx
            });
        }
        idx++;
        return prev;
    }, [{
        name: "",
        group: 0
    }]);
    const excludes = indexMapped.filter(i => i.name[0] === "!").map(i => i.name);
    _.remove(indexMapped, i => _.includes(excludes, i.name));
    return {
        excludes: excludes.map(v => v.substring(1)),
        pack: _.orderBy(indexMapped, [i => i.name.length, i => i], ["desc", "asc"])
    };
}

/**
 * @hidden
 */
export function publicOptionToprivate(pubOption: GameAssetPluginOption) {
    let atlasMapFunc: () => bb<AtlasMapType> = () => bb.resolve<AtlasMapType>({
        excludes: [],
        pack: [
            { name: "", group: 0 }
        ]
    });
    const atlasMap = pubOption.atlasMap;
    let atlasMapFile: string = undefined;
    if (typeof atlasMap === "string") {
        atlasMapFunc = () => readFileAsync(
            atlasMap
        ).then(
            buf => JSON.parse(buf.toString("utf-8")) as (string | string[])[]
        ).then(sortAtlasMap);
        atlasMapFile = atlasMap;
    } else if (atlasMap != null) {
        const sorted = sortAtlasMap(atlasMap);
        atlasMapFunc = () => bb.resolve(sorted);
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
            padding: pubOption.padding
        },
        entryOption() {
            return readFileAsync(
                pubOption.entryOption
            ).then(
                buf => _.assign(JSON.parse(buf.toString("utf-8")), { _path: pubOption.entryOption })
            );
        },
        mergeJson: pubOption.mergeJson || false,
        audioSprite: pubOption.audioSprite || false,
        refPresets: pubOption.refPresets || {},
        collectAll: pubOption.collectAll == null ? false : pubOption.collectAll,
        audioEncode: pubOption.audioEncode || []
    } as InternalOption;
}

/**
 * @hidden
 */
export interface ProcessContext {
    compilation: wp.Compilation;
    context: string;
    cache: { [key: string]: any };
    option: InternalOption;

    isChanged(file: string): boolean;
}
