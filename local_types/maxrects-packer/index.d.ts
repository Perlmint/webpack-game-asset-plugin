declare class MaxRectsPacker implements MaxRectsPacker.IMaxRectsPacker {
    constructor(maxWidth?: number, maxHeight?: number, padding?: number, options?: MaxRectsPacker.Option);
    add(width: number, height: number, data: any): void;
    addArray(...objects: MaxRectsPacker.Item[]): void;
    save(): MaxRectsPacker.Bins;
    load(bins: MaxRectsPacker.Bins): void;
    bins: MaxRectsPacker.Bins;
}

declare namespace MaxRectsPacker {
    interface IMaxRectsPacker {
        add(width: number, height: number, data: any): void;
        addArray(...objects: Item[]): void;
        save(): Bins;
        load(bins: Bins): void;
        bins: Bins;
    }

    type Bins = Bin[];
    interface Bin {
        width: number;
        height: number;
        rects: Rect[];
    }
    type Rect = NormalRect | OversizedRect;
    interface Item {
        width: number;
        height: number;
        data?: any;
    }
    interface BaseRects extends Item {
        x: number;
        y: number;
    }
    interface NormalRect extends BaseRects {
        oversized: false;
    }
    interface OversizedRect extends BaseRects {
        oversized: true;
        maxWidth: number;
        maxHeight: number;
    }

    interface Option {
        /**
         * packing with smallest possible size
         */
        smart?: boolean;
        /**
         * bin size round up to smallest power of 2
         */
        pot?: boolean;
        /**
         * bin size shall alway be square
         */
        square?: boolean;
    }
}

export = MaxRectsPacker;