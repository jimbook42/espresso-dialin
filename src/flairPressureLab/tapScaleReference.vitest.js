import {describe,it,expect} from 'vitest';
import {zeroFromTapAngles,barFromTapAnchors} from './tapCalibrate.js';
import {PROFILE_FIVE_DEG,PROFILE_TEN_DEG} from './anchorRegularize.js';
describe('tap-only scale reference',()=>{
 it.each([0,47,190,325])('transfers the existing profile across rotation %s',zero=>{
 const five=(zero+PROFILE_FIVE_DEG)%360,ten=(zero+PROFILE_TEN_DEG)%360;
 expect(zeroFromTapAngles(five,ten)).toBeCloseTo(zero,8);
 });
 it('preserves user rays and scales the profile with their angular spacing',()=>{
 const five=56.41233214481815,ten=146.17233214481814;
 const zero=zeroFromTapAngles(five,ten);
 expect(barFromTapAnchors(five,zero,five,ten)).toBe(5);
 expect(barFromTapAnchors(ten,zero,five,ten)).toBe(10);
 expect(barFromTapAnchors(276.47032535326525,zero,five,ten)).toBeNull();
 });
});
