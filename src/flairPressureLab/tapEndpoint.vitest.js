import {describe,it,expect} from 'vitest';
import {barFromTapAnchors,endpointIsResolved} from './tapCalibrate.js';
describe('pixel uncertainty at full scale',()=>{
 it('never extrapolates pressure past the ten ray',()=>{
 expect(barFromTapAnchors(307,140,214,302)).toBeNull();
 expect(barFromTapAnchors(302,140,214,302)).toBe(10);
 });
 it('withholds an unresolved endpoint and allows a clearly interior reading',()=>{
 expect(endpointIsResolved(44.762,45.542,85,50)).toBe(false);
 expect(endpointIsResolved(45.542,45.542,85,50)).toBe(false);
 expect(endpointIsResolved(51,45.542,85,50)).toBe(false);
 expect(endpointIsResolved(38,45.542,85,50)).toBe(true);
 });
 it('scales uncertainty with actual pixel resolution and handles wraparound',()=>{
 expect(endpointIsResolved(359,1,85,50)).toBe(false);
 expect(endpointIsResolved(359,1,850,500)).toBe(true);
 expect(endpointIsResolved(null,1,85,50)).toBe(false);
 });
});
