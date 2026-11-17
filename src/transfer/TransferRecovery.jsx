import { appTransferStore } from './transferStore.js';

export function TransferRecovery({ root, error }) {
  const retry = () => window.location.reload();
  const restorePrevious = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await appTransferStore().rollbackPending();
      retry();
    } catch (err) {
      button.disabled = false;
      root.render(<TransferRecovery root={root} error={err} />);
    }
  };
  return <main className="mx-auto max-w-lg space-y-3 p-5 text-sm">
    <h1 className="text-lg font-semibold">Finish app transfer</h1>
    <p role="alert">{error?.message || 'The transfer was interrupted.'}</p>
    <p>The app will reopen when the stored data can be verified. Free space if needed, then retry or cancel and recover the previous data.</p>
    <div className="flex flex-wrap gap-3">
      <button className="rounded-lg border px-3 py-2" type="button" onClick={retry}>Retry transfer</button>
      <button className="rounded-lg border px-3 py-2" type="button" onClick={restorePrevious}>Cancel and recover previous data</button>
    </div>
  </main>;
}
