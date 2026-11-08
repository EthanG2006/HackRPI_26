import {useEffect} from 'react';
import {useApp} from '../store';
import {goBeat} from './beats';

export function usePresenterKeys() {
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const s = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); s.set({paletteOpen: !s.paletteOpen}); return;
      }
      if (e.key === 'Escape') {
        s.set({paletteOpen:false, copilotOpen:false, notesOpen:false, page:null});
        if (s.whatif.drawing) s.setWhatIf({drawing:false});
        return;
      }
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && (e.target.matches('input,textarea,select') || e.target.isContentEditable))) return;
      if (/^[1-8]$/.test(e.key)) { e.preventDefault(); goBeat(Number(e.key)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goBeat(Math.min(8,Math.max(1,s.beat)+1)); }
      else if (e.key.toLowerCase() === 'r') goBeat(1);
      else if (e.key.toLowerCase() === 'n') s.set({notesOpen: !s.notesOpen});
      else if (e.code === 'Space' && !s.page && !s.paletteOpen && !s.copilotOpen && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault(); if (!s.introDone) goBeat(2); else s.setPlaying(!s.playing);
      }
    }
    window.addEventListener('keydown',key);
    return () => window.removeEventListener('keydown',key);
  },[]);
}
