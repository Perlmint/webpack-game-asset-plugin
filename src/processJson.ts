import * as bb from "bluebird";
import { Compilation } from "webpack";
import { fromPairs, clone, keys } from "lodash";
import { join } from "path";
import { readFileAsync } from "./util";
import { FilesByType } from "./option";

export function processJson(context: string, pack: boolean, compilation: Compilation, files: [FilesByType, FilesByType]): bb<[FilesByType, FilesByType]> {
    const [toCopy, assets] = files;
    if (!pack) {
        return bb.resolve(files);
    }
    const jsonFiles = assets["json"];
    delete toCopy["json"];
    delete assets["json"];
    const others = clone(files);
    return bb.map(
        keys(jsonFiles),
        filename => readFileAsync(join(context, jsonFiles[filename].srcFile)).then(
            buf => buf.toString("utf-8")
        ).then<[string, any]>(
            data => [filename, JSON.parse(data)]
        )
    ).then(
        data => fromPairs(data)
    ).then<[FilesByType, FilesByType]>(
        merged => {
            assets["mergedjson"] = {
                "data.json": {
                    ext: ".json",
                    name: "data.json",
                    outFile: "data.json",
                    srcFile: ""
                }
            };
            const stringified = JSON.stringify(merged);
            compilation.assets["data.json"] = {
                size: () => stringified.length,
                source: () => stringified
            };
            return [toCopy, assets];
    });
}
