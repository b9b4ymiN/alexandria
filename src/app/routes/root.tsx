// Placeholder shell page for the G1.0 scaffold node.
// Library, Reader and Admin routes are added by later graph nodes.
export function Root() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Alexandria</h1>
        <p className="mt-2 text-sm text-slate-600">
          Scaffold running. Library, Reader and Admin ship in later nodes.
        </p>
      </div>
    </main>
  );
}
