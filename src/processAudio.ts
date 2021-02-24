import * as wp from "webpack";
import * as bb from "bluebird";
import * as _ from "lodash";
import { InternalOption, FilesByType, File, Assets, ProcessContext, Compilation } from "./option";
import { localJoinPath, readFileAsync } from "./util";
import { dir, file as tmpFile } from "tmp-promise";
import { relative } from "path";

/**
 * @hidden
 */
export async function processAudio(context: ProcessContext, compilation: Compilation, files: [FilesByType, Assets]): Promise<[FilesByType, Assets]> {
    const [toCopy, assets] = files;
    const audios = toCopy["audio"];
    toCopy["audio"] = {};
    assets["audio"] = {};
    assets["audioSprite"] = {};
    if (context.option.audioSprite) {
        if (!_.every(_.values(audios), file => !context.isChanged(compilation, file.srcFile))) {
            assets["audioSprite"]["as"] = {
                args: [context.cache["audiosprite"], "as.json"]
            };
        }
        const [tmp, audiosprite] = await bb.all([dir(), import("audiosprite")]);
        await new bb<[FilesByType, Assets]>((resolve, reject) => audiosprite(_.map(audios, audio => audio.srcFile), {
            output: localJoinPath(tmp.path, "as")
        }, (error, obj) => {
            if (error) {
                reject(error);
            }

            const resourceNames = obj.resources.map(v => relative(tmp.path, v));
            bb.map(obj.resources, (res, i) => readFileAsync(res).then(audio => {
                compilation.emitAsset(resourceNames[i], new wp.sources.RawSource(audio, false));
            }));
            obj.resources = resourceNames;
            const audioSpriteAtlas = JSON.stringify(obj);
            compilation.emitAsset("as.json", new wp.sources.RawSource(audioSpriteAtlas, true));
            assets["audioSprite"]["as"] = {
                args: [obj.resources, "as.json"]
            };
            _.forEach(audios, audio => {
                audio.outType = "audioSprite";
                audio.outFile = ["as.json", ...obj.resources];
            });

            context.cache["audiosprite"] = obj.resources;

            resolve();
        }));
    }
    else {
        const ffmpeg = await import("fluent-ffmpeg");
        for (const file of _.values(audios)) {
            let encodeTargets = context.option.audioEncode;
            const originalCodec = file.ext.replace(".", "");
            const originalCodecIndex = _.indexOf(encodeTargets, originalCodec);
            if (originalCodecIndex > 0) {
                encodeTargets = _.clone(encodeTargets);
                encodeTargets.splice(originalCodecIndex, 1);
                encodeTargets.unshift(originalCodec);
            }
            const converteds = await bb.map(encodeTargets, async codec => {
                if (file.ext === "." + codec) {
                    toCopy["audio"][file.name] = file;
                    return typeof file.outFile === "string" ? file.outFile : file.outFile[0];
                }

                const name = `${file.name}.${file.hash}.${codec}`;

                if (await context.isChanged(compilation, file.srcFile)) {
                    const outFile = await tmpFile({
                        postfix: "." + codec,
                        detachDescriptor: true
                    });
                    await new bb<string>(resolve => ffmpeg(file.srcFile).save(outFile.path).on("end", async () => {
                        const outData = await readFileAsync(outFile.path);
                        compilation.emitAsset(name, new wp.sources.RawSource(outData, false));
                        resolve();
                    }));
                }
                return name;
            });

            assets["audio"][file.name] = {
                args: converteds
            };
            file.outType = "audio";
            file.outFile = converteds;
        }
    }

    return [toCopy, assets];
}
