import {describe,it,expect} from 'vitest';
import {barFromTapAnchors,endpointIsResolved} from './tapCalibrate.js';
describe('pixel uncertainty at full scale',()=>{
 it('never extrapolates pressure past the ten ray',()=>{
 expect(barFromTapAnchors(307,140,214,302)).toBeNull();
 expect(barFromTapAnchors(302,140,214,302)).toBe(10);
 });
 it('withholds an unresolved endpoint and allows a clearly interior reading',()=>{
 expect(endpointIsResolved(44.762,231,45.542,85,50)).toBe(false);
 expect(endpointIsResolved(45.542,231,45.542,85,50)).toBe(false);
 expect(endpointIsResolved(51,231,45.542,85,50)).toBe(false);
 expect(endpointIsResolved(38,231,45.542,85,50)).toBe(true);
 });
 it('scales uncertainty with actual pixel resolution and handles wraparound',()=>{
 expect(endpointIsResolved(359,270,1,85,50)).toBe(false);
 expect(endpointIsResolved(359,270,1,850,500)).toBe(true);
 expect(endpointIsResolved(null,270,1,85,50)).toBe(false);
 });
 it('keeps a near-zero ray on a calibrated arc wider than 180 degrees',()=>{
 const zero=321.25380577645245,ten=144.0253224912841,nearZero=321.74129596371256;
 expect((ten-zero+360)%360).toBeGreaterThan(180);
 expect(endpointIsResolved(nearZero,zero,ten,85,50)).toBe(true);
 expect(endpointIsResolved(51.3035,231.89,45.4003,85,50)).toBe(false);
 });
});

