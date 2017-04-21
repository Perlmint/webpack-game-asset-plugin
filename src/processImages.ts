import * as wp from "webpack";
import * as bb from "bluebird";
import * as _ from "lodash";
import * as nsg from "node-sprite-generator";
import { InternalOption, FilesByType, File } from "./option";
import { localJoinPath, tmpFile, SynchrounousResult, readFileAsync, debug } from "./util";
import { stylesheet } from "./stylesheet";

export function processImages(context: string, option: InternalOption, compilation: wp.Compilation, fileByType: FilesByType) {
    if (option.makeAtlas === false) {
        debug("copy images");
        return bb.resolve(fileByType);
    }

    const images = fileByType["image"];
    fileByType["image"] = {};
    const others = _.clone(fileByType);
    fileByType["atlas"] = {};
    let idx = 0;

    debug("generate atlas");
    return option.atlasMap().then(
        map => {
            const excludes = _.keys(images).filter(img => _.find(map.excludes, e => _.startsWith(img, e)));
            for (const key of excludes) {
                others["image"][key] = images[key];
                delete images[key];
            }
            const sources: {[key: string]: [string, File][]} = {};
            _.forEach(images, (file, key) => {
                for (const pfxkv of map.pack) {
                    const { name: pfx, group: idx } = pfxkv;
                    if (!_.startsWith(key, pfx)) {
                        continue;
                    }

                    if (sources[idx] === undefined) {
                        sources[idx] = [];
                    }
                    sources[idx].push([key, file]);
                    break;
                }
            });
            return sources;
        }
    ).then(sources => bb.all(_.map(sources, (source, outName) => new bb((resolve, reject) => {
        try {
            const [atlas, info] = [".png", ".json"].map(postfix => tmpFile({
                postfix,
                discardDescriptor: true
            }));
            const imgSrcs = _.fromPairs(source.map(src => [localJoinPath(context, src[1].srcFile), src[0]]));

            nsg({
                src: _.keys(imgSrcs),
                compositor: option.compositor,
                layout: "packed",
                spritePath: atlas.name,
                stylesheetPath: info.name,
                stylesheet: (layout: NodeSpriteGenerator.Layout, stylesheetPath: string, spritePath: string, options: NodeSpriteGenerator.Option, callback: (error: Error) => void) => stylesheet(outName + ".png", imgSrcs, layout, stylesheetPath, spritePath, options, callback)
            }, e => {
                if (e == null) {
                    bb.all(
                        _.map<[SynchrounousResult , string], bb<void>>(
                            [[atlas, ".png"], [info, ".json"]],
                            names =>
                                readFileAsync(names[0].name).then(content => {
                                    compilation.assets[outName + names[1]] = {
                                        size: () => content.length,
                                        source: () => content
                                    };
                                    names[0].removeCallback();
                                })
                        )
                    ).then(() => {
                        fileByType["atlas"][outName] = {
                            ext: ".png",
                            name: outName,
                            outFile: [outName + ".png", outName + ".json"],
                            srcFile: ""
                        };
                    }).then(() => {
                        resolve();
                    }).catch(e => {
                        debug("Error occured while register generated atlas as assets");
                        reject(e);
                    });
                } else {
                    debug("Error occured while atlas generating");
                    reject(e);
                }
            });
        } catch (e) {
            reject(e);
        };
    })))).then(() => others);
}
