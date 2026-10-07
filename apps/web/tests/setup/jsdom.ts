// Setup for component tests. A test that does not run in jsdom skips this file's work.
import { afterEach } from 'vitest';

if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());

  // jsdom does not implement showModal() and close() of <dialog>.
  // `components/ui/dialog.tsx` calls both.
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
}
