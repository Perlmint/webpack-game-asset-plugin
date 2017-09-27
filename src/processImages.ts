import * as wp from "webpack";
import * as bb from "bluebird";
import * as _ from "lodash";
import { parse as parsePath, format as formatPath, dirname } from "path";
import { InternalOption, FilesByType, File, isFile, Assets, ProcessContext, AtlasMapType } from "./option";
import { localJoinPath, tmpFile, SynchrounousResult, readFileAsync, debug } from "./util";
import { stylesheet } from "./stylesheet";
import { createHash } from "crypto";

/**
 * @hidden
 */
interface SourceTree<T>  {
    files?: {[name: string]: T};
    dirs?: {[name: string]: SourceTree<T>};
}

/**
 * @hidden
 */
interface Size {
    w: number;
    h: number;
}

/**
 * @hidden
 */
async function getImageSize(path: string, padding: number = 0) {
    const gm = await import("gm");
    return new Promise<Size>((resolve, reject) => gm(path).size((e, v) => {
        if (e != null) {
            return reject(e);
        }
        resolve({
            w: v.width + padding * 2,
            h: v.height + padding * 2
        });
    }));
}

import * as ShelfPack from "@mapbox/shelf-pack";

type Packs = {
    pack?: [ShelfPack, ShelfPack.Bin[]][]
    sub?: { [name: string]: Packs };
};

function size(p: [ShelfPack, ShelfPack.Bin[]]) {
    return _.reduce(p[1], (acc, o) => acc + o.w * o.h, 0);
}

function mergePack(width: number, height: number, p1: ShelfPack.Bin[], p2: ShelfPack.Bin[]) {
    const pack = new ShelfPack(width, height);
    const all = [...p1, ...p2];
    const packed = pack.pack(sortBin(all));
    (pack as any).shrink();
    if (packed.length === all.length) {
        return [pack, packed] as [ShelfPack, ShelfPack.Bin[]];
    } else {
        return null;
    }
}

function sortBin(bins: ShelfPack.RequestShort[]) {
    return _.orderBy(bins, [(b) => Math.floor(b.w * b.h / 10), "w", "h"], ["desc", "desc", "desc"]);
}

/**
 * @hidden
 */
async function packImages(width: number, height: number, tree: SourceTree<File & Size>) {
    let packs: Packs = {};
    {
        let name: string[] = [];
        while (true) {
            if (tree.files !== undefined) {
                break;
            }
            if (tree.dirs === undefined) {
                break;
            }
            if (_.size(tree.dirs) !== 1) {
                break;
            }
            name.push(_.keys(tree.dirs)[0]);
            tree = _.values(tree.dirs)[0];
        }

        const queue: [SourceTree<File & Size>, string][] = [[tree, `sub.${name.join("/")}`]];
        while (queue.length !== 0) {
            const [node, name] = queue.pop();
            if (node.dirs !== undefined) {
                queue.push(..._.map(
                    node.dirs,
                    (o, k) => [o, `${name}.sub.${k}`] as [SourceTree<File & Size>, string]
                ));
            }
            if (node.files !== undefined) {
                // leaf node
                let _p: Packs = _.get(packs, name);
                if (_p === undefined) {
                    _p = { pack: [] };
                    _.setWith(packs, name, _p, Object);
                }
                let files = sortBin(_.map(node.files, f => ({
                    id: f.srcFile,
                    w: f.w,
                    h: f.h
                })));
                while (true) {
                    const pack = new ShelfPack(width, height);
                    const packed = pack.pack(files);
                    _p.pack.push([pack, packed]);
                    (pack as any).shrink();
                    if (packed.length !== files.length) {
                        // some images remain
                        files = _.differenceBy(files, packed, "id");
                    } else {
                        break;
                    }
                }
            }
        }
    }

    // merge small ones
    {
        const sub_queue: [Packs, string][] = _.map(packs.sub, (s, k) => [s, k] as [Packs, string]);
        const bin_queue: [ShelfPack, ShelfPack.Bin[]][] = [];
        while (sub_queue.length !== 0) {
            const [node, name] = sub_queue.pop();
            if (node.sub !== undefined) {
                sub_queue.push(..._.map(
                    node.sub,
                    (o, k) => [o, `${name}.sub.${k}`] as [Packs, string]
                ));
            } else if (node.pack !== undefined) {
                bin_queue.push(...node.pack);
            }
        }
        let ret: [ShelfPack, ShelfPack.Bin[]][] = [];
        let currentPack = bin_queue.pop();
        while (bin_queue.length !== 0) {
            const new_pack = bin_queue.pop();
            const __ = mergePack(width, height, currentPack[1], new_pack[1]);
            if (__ === null) {
                if (size(currentPack) > size(new_pack)) {
                    ret.push(currentPack);
                    currentPack = new_pack;
                } else {
                    ret.push(new_pack);
                }
            } else {
                currentPack = __;
            }
        }
        ret.push(currentPack);

        return ret;
    }
}

/**
 * @hidden
 */
export async function processImages(context: ProcessContext, option: InternalOption, files: [FilesByType, Assets]): Promise<[FilesByType, Assets]> {
    const [toCopy, assets] = files;

    const images = toCopy["image"];
    toCopy["image"] = {};
    delete assets["image"];
    assets["atlas"] = {};
    let idx = 0;

    const map = await option.atlasMap(context.context);

    debug("generate atlas");

    const excludes = _.keys(images).filter(img => _.find(map.excludes, e => _.startsWith(img, e)));
    for (const key of excludes) {
        toCopy["image"][key] = images[key];
        delete images[key];
    }

    let sources: SourceTree<File & Size> = {};
    let binFileMap: {[key: string]: File} = {};
    let localizeds: {[language: string]: SourceTree<File & Size>} = {};
    // make source image tree based on location
    await bb.all(_.map(images, async (file, key) => {
        // do not pack
        if (file.query["raw"]) {
            toCopy["image"][key] = file;

            return;
        }
        // oversize!
        const size = await getImageSize(file.srcFile, option.atlasOption.padding);
        if (size.w > option.atlasOption.width || size.h > option.atlasOption.height) {
            toCopy["image"][key] = file;

            return;
        }
        const path = ["dirs"].concat(dirname(file.srcFile).replace(/\\/g, "/").replace(/\//g, "/dirs/").split("/").concat(["files"]));

        // has localized resource
        if (file.localized.length > 1) {
            for (let lang of file.localized) {
                const parsedPath = parsePath(file.srcFile);
                if (lang !== "") {
                    lang = `@${lang}`;
                }

                const localizedSrc = localJoinPath(parsedPath.dir, `${parsedPath.name}${lang}${parsedPath.ext}`);
                _.setWith(localizeds, _.concat(["dirs", lang], ...path), _.defaults({
                    srcFile: localizedSrc
                }, file, await getImageSize(localizedSrc, option.atlasOption.padding)), Object);
            }
            return;
        }

        let node: any[] = _.get(sources, path);
        if (node === undefined) {
            node = [];
            _.setWith(sources, path, node, Object);
        }
        binFileMap[file.srcFile] = file;
        node.push(Object.assign(file, size));
    }));

    const packs = await packImages(option.atlasOption.width, option.atlasOption.height, sources);

    await bb.all(_.map(packs, (info, idx) => new bb(async (resolve, reject) => {
        try {
            const outName = idx.toString(10);

            const gm = await import("gm");
            const img = gm(info[0].w, info[0].h, "#FFFFFFFF");
            for (const bin of info[1]) {
                (img as any).in(
                    "-geometry", `${bin.w}x${bin.h}`
                ).in(
                    "-page", `+${bin.x + option.atlasOption.padding}+${bin.y + option.atlasOption.padding}`
                ).in(
                    bin.id
                );
            }
            img.mosaic();

            img.toBuffer("PNG", async (e, buffer) => {
                if (e != null) {
                    return reject(e);
                }

                const frameInfo = {
                    frames: _.fromPairs(_.map(
                        info[1],
                        src => {
                            const file = binFileMap[src.id];
                            return [file.name, {
                                frame: {
                                    h: src.h,
                                    w: src.w,
                                    x: src.x,
                                    y: src.y
                                },
                                rotated: false,
                                sourceSize: {
                                    h: src.h,
                                    w: src.w
                                },
                                spriteSourceSize: {
                                    x: 0,
                                    y: 0,
                                    h: src.h,
                                    w: src.w
                                },
                                trimmed: false
                            }];
                        })
                    ),
                    meta: {
                        image: outName + ".png",
                        scale: 1,
                        size: {
                            w: info[0].w,
                            h: info[0].h
                        }
                    }
                };
                for (const src of info[1]) {
                    const file = binFileMap[src.id];
                    file.outFile = [outName + ".png", outName + ".json"];
                    file.outName = outName;
                    file.outType = "atlas";
                }
                let hashStr: string;
                const hash = createHash("md5");
                hash.update(buffer);
                hashStr = hash.digest("hex");
                context.compilation.assets[outName + ".png"] = {
                    size: () => buffer.length,
                    source: () => buffer
                };
                const frameInfoStr = JSON.stringify(frameInfo);
                context.compilation.assets[outName + ".json"] = {
                    size: () => frameInfoStr.length,
                    source: () => frameInfoStr
                };
                assets["atlas"][outName] = {
                    ext: ".png",
                    name: outName,
                    hash: hashStr,
                    outFile: [outName + ".png", outName + ".json"],
                    args: undefined,
                    srcFile: ""
                };
                resolve();
            });
        } catch (e) {
            reject(e);
        }
    })));

    return [toCopy, assets];
}
