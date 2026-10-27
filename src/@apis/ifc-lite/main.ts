// ifc-lite library only (engine glue, geometry, WebGPU renderer, parser for properties); the viewer logic lives in the
// Sharepoint Previewer script. Nothing is fetched by this code: the .wasm bytes are passed in.

import { GeometryProcessor } from '@ifc-lite/geometry';
import { IfcParser } from '@ifc-lite/parser';
import { extractProjectUnits } from '@ifc-lite/parser';
import { extractPropertiesOnDemand } from '@ifc-lite/parser';
import { extractQuantitiesOnDemand } from '@ifc-lite/parser';
import { extractTypePropertiesOnDemand } from '@ifc-lite/parser';
import { extractTypeQuantitiesOnDemand } from '@ifc-lite/parser';
import { mergeInheritedPropertySets } from '@ifc-lite/parser';
import { mergeInheritedQuantitySets } from '@ifc-lite/parser';
import { Renderer } from '@ifc-lite/renderer';
import init from '@ifc-lite/wasm';

globalThis.IfcLite = {
    init,
    GeometryProcessor,
    Renderer,
    IfcParser,
    extractProjectUnits,
    extractPropertiesOnDemand,
    extractQuantitiesOnDemand,
    extractTypePropertiesOnDemand,
    extractTypeQuantitiesOnDemand,
    mergeInheritedPropertySets,
    mergeInheritedQuantitySets,
};
