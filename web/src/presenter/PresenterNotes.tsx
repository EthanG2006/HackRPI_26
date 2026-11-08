import {useApp} from '../store';
import {beats} from './beats';
export default function PresenterNotes() {
  const open=useApp(s=>s.notesOpen), index=useApp(s=>Math.max(0,s.beat-1));
  return open ? <aside className="notes"><span className="eyebrow">Presenter notes · {index+1}/8</span><h3>{beats[index][0]}</h3><p>{beats[index][1]}</p><small>→ Next beat　 N Close notes</small></aside> : null;
}
