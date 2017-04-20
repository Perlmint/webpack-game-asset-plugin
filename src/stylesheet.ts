import { writeFile } from "fs";
import { normalize } from "path";
import "node-sprite-generator";

interface Size {
    w: number;
    h: number;
}

interface Rect extends Size {
    x: number;
    y: number;
}

interface IFrame {
    frame: Rect;
    rotated: boolean;
    trimmed: boolean;
    spriteSourceSize: Rect;
    sourceSize: Size;
}

interface ISheet {
    frames: {[key: string]: IFrame};
    meta: {
        app?: string;
        version?: string;
        image: string;
        size: Size;
        scale: number;
    };
}

export function stylesheet(name: string, filesMap: {[key: string]: string}, layout: NodeSpriteGenerator.Layout, stylesheetPath: string, spritePath: string, options: NodeSpriteGenerator.Option, callback: (error: Error) => void) {
    const ret: ISheet = {
        frames: {},
        meta: {
            image: name,
            size: {
                w: layout.width,
                h: layout.height
            },
            scale: 1
        }
    };
    for (const image of layout.images) {
        ret.frames[filesMap[normalize(<string>(image as any)["path"])]] = {
            frame: {
                h: image.height,
                w: image.width,
                x: image.x,
                y: image.y
            },
            rotated: false,
            sourceSize: {
                h: image.height,
                w: image.width
            },
            spriteSourceSize: {
                x: 0,
                y: 0,
                h: image.height,
                w: image.width
            },
            trimmed: false
        };
    }

    writeFile(stylesheetPath, JSON.stringify(ret), err => {
        callback(err);
    });
}
