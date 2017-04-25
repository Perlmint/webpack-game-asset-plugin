import * as nsg from "node-sprite-generator";
import * as bb from "bluebird";
import * as _ from "lodash";
import { readFileAsync } from "./util";
import { Option as EntryOption } from "./entryGenerator";

export interface File {
    name: string;
    ext: string;
    outFile: string | string[];
    srcFile: string;
};

export type FilesByType = {[key: string]: {[key: string]: File}};

export type PackType = {
    name: string;
    group: number;
};

export type AtlasMapType = {
    excludes: string[];
    pack: PackType[]
};

export interface GameAssetPluginOption {
    makeAtlas?: boolean;
    atlasMap?: string | (string | string[])[];
    assetRoots: (string | [string, string])[];
    excludes?: string[];
    listOut: string;
    compositor?: nsg.Compositor;
    padding?: number;
    entryOption: string;
};

export interface InternalOption {
    makeAtlas: boolean;
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
}

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
        entryOption: () => readFileAsync(
            pubOption.entryOption
        ).then(
            buf => JSON.parse(buf.toString("utf-8"))
        )
    } as InternalOption;
};
