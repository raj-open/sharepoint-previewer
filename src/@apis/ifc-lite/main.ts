// ifc-lite library only (engine glue, geometry, WebGPU renderer); the viewer logic lives in the
// Sharepoint Previewer script. Nothing is fetched by this code: the .wasm bytes are passed in.

import { GeometryProcessor } from '@ifc-lite/geometry';
import { Renderer } from '@ifc-lite/renderer';
import init from '@ifc-lite/wasm';

globalThis.IfcLite = { init, GeometryProcessor, Renderer };
