import { useProject } from './project/store.ts';
import { useProjectChrome } from './project/useProjectChrome.ts';
import { Editor } from './ui/Editor.tsx';
import { Home } from './ui/Home.tsx';
import { Prompts } from './ui/Prompts.tsx';

export function App() {
  const hasProject = useProject((s) => s.project !== null);
  useProjectChrome();

  return (
    <>
      {hasProject ? <Editor /> : <Home />}
      <Prompts />
    </>
  );
}
