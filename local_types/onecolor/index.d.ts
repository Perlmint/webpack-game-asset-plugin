declare abstract class Color {
    // HSV / HSL
    hue(): number;
    hue(h: number, delta?: boolean): Color;
    saturation(): number;
    saturation(s: number, delta?: boolean): Color;
    value(): number;
    value(v: number, delta?: boolean): Color;
    lightness(): number;
    lightness(l: number, delta?: boolean): Color;

    // RGB
    red(): number;
    red(r: number, delta?: boolean): Color;
    green(): number;
    green(g: number, delta?: boolean): Color;
    blue(): number;
    blue(b: number, delta?: boolean): Color;

    alpha(): number;
    alpha(a: number, delta?: boolean): Color;

    // CYMK
    cyan(): number;
    cyan(c: number, delta?: boolean): Color;
    yellow(): number;
    yellow(y: number, delta?: boolean): Color;
    magenta(): number;
    magenta(m: number, delta?: boolean): Color;
    black(): number;
    black(b: number, delta?: boolean): Color;

    hex(): string;
    css(): string;
    cssa(): string;
    toString(): string;
    toJSON(): string;

    equals(c: Color, epsilon: number): boolean;

    rgb(): color.RGB;
    hsl(): color.HSL;
    hsv(): color.HSV;
    cymk(): color.CYMK;
}

declare function color(color: [string, number, number,  number, number]): Color;
declare function color(color: [number, number,  number, number]): Color;
declare function color(color: string): Color;

declare namespace color {
    export class RGB extends Color {
        constructor(red: number, green: number, blue: number, alpha?: number);
    }

    export class HSL extends Color {
        constructor(red: number, green: number, blue: number, alpha?: number);
    }

    export class HSV extends Color {
        constructor(red: number, green: number, blue: number, alpha?: number);
    }

    export class CYMK extends Color {
        constructor(cyan: number, yellow: number, magenta: number, black: number, alpha?: number);
    }
}

export = color; 