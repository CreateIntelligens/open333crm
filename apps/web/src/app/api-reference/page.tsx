import ApiReferenceViewer from './viewer';

export const metadata = {
  title: 'API Reference | Open333CRM',
  description: 'Browse the Open333CRM HTTP API reference.',
};

export default function ApiReferencePage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 px-6 py-6 md:px-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-700">Open333CRM</p>
        <h1 className="mt-2 text-3xl font-semibold">API Reference</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          This reference lists registered HTTP endpoints, including the MCP transport endpoint. Operations marked as undocumented still need request or response schemas. MCP JSON-RPC methods and Socket.IO events use separate protocol documentation.
        </p>
      </header>
      <ApiReferenceViewer />
    </main>
  );
}
