import { Composition } from 'remotion';
import { DURATION, Promo } from './Promo';
import { FPS, HEIGHT, WIDTH } from './theme';

export function Root() {
  return (
    <>
      <Composition id="Promo" component={Promo} defaultProps={{ lang: 'sh' as const }} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="PromoEN" component={Promo} defaultProps={{ lang: 'en' as const }} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
  );
}
