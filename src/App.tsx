import { useEffect } from 'react';
import { setVolume } from './audio/sfx';
import { useGame } from './state/store';
import { LevelSelect, MainMenu, RecordsScreen, SettingsScreen } from './ui/MenuScreens';
import { PlayScreen } from './ui/PlayScreen';
import { LevelCompleteScreen, LevelFailedScreen } from './ui/ResultScreens';
import { ShopScreen } from './ui/ShopScreen';

export default function App() {
  const screen = useGame((s) => s.screen);
  const attemptId = useGame((s) => s.attemptId);
  const volume = useGame((s) => s.settings.volume);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);

  useEffect(() => setVolume(volume), [volume]);

  return (
    <div className={reducedMotion ? 'reduce-motion' : ''}>
      {(screen === 'playing' || screen === 'paused') && <PlayScreen key={attemptId} />}
      {screen === 'menu' && <MainMenu />}
      {screen === 'levelSelect' && <LevelSelect />}
      {screen === 'records' && <RecordsScreen />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'shop' && <ShopScreen />}
      {screen === 'complete' && <LevelCompleteScreen />}
      {screen === 'failed' && <LevelFailedScreen />}
    </div>
  );
}
