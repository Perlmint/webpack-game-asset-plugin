import * as wp from "webpack";
import * as bb from "bluebird";
import * as _ from "lodash";
import { InternalOption, FilesByType, File, Assets, ProcessContext } from "./option";
import { tmpDir, tmpFile, localJoinPath, readFileAsync } from "./util";
import { relative } from "path";

/**
 * @hidden
 */
export async function processAudio(context: ProcessContext, files: [FilesByType, Assets]): bb<[FilesByType, Assets]> {
    const [toCopy, assets] = files;
    const audios = toCopy["audio"];
    toCopy["audio"] = {};
    assets["audio"] = {};
    assets["audioSprite"] = {};
    if (context.option.audioSprite) {
        const tmp = tmpDir();
        const audiosprite = await import("audiosprite");
        return new bb<[FilesByType, Assets]>((resolve, reject) => audiosprite(_.map(audios, audio => audio.srcFile), {
            output: localJoinPath(tmp.name, "as")
        }, (error, obj) => {
            if (error) {
                reject(error);
            }

            const resourceNames = obj.resources.map(v => relative(tmp.name, v));
            bb.map(obj.resources, (res, i) => readFileAsync(res).then(audio => {
                context.compilation.assets[resourceNames[i]] = {
                    size: () => audio.length,
                    source: () => audio
                };
            }));
            obj.resources = resourceNames;
            const audioSpriteAtlas = JSON.stringify(obj);
            context.compilation.assets["as.json"] = {
                size: () => audioSpriteAtlas.length,
                source: () => audioSpriteAtlas
            };
            assets["audioSprite"]["as"] = {
                args: [obj.resources, "as.json"]
            };

            resolve([toCopy, assets]);
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
                    return file.outFile;
                }

                if (context.isChanged(file.srcFile)) {
                    const outFile = tmpFile({
                        postfix: "." + codec,
                        detachDescriptor: true
                    });
                    await new bb<string>(resolve => ffmpeg(file.srcFile).save(outFile.name).on("end", async () => {
                        const outData = await readFileAsync(outFile.name);
                        context.compilation.assets[file.name + "." + codec] = {
                            size: () => outData.length,
                            source: () => outData
                        };
                        resolve();
                    }));
                }
                return file.name + "." + codec;
            });

            assets["audio"][file.name] = {
                args: converteds
            };
        }

        return [toCopy, assets];
    }
}
