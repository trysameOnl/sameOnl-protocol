import sharp from 'sharp';
import { readRgba, cropToSphere } from '../lib/assets.mjs';
const src = await readRgba('brand/LOGO SAME PNG...png');
console.log(src.width, src.height, src.data.length, src.width*src.height*4);
const c = cropToSphere(src);
console.log(c.width, c.data.length, c.width*c.height*4);
const a = Buffer.alloc(c.width*c.width);
const r = await sharp(a,{raw:{width:c.width,height:c.width,channels:1}}).resize(100,100).raw().toBuffer({resolveWithObject:true});
console.log(r.info);
const r3 = await sharp(Buffer.alloc(c.width*c.width*3),{raw:{width:c.width,height:c.width,channels:3}}).resize(100,100).raw().toBuffer({resolveWithObject:true});
console.log(r3.info);
process.exit(0)
