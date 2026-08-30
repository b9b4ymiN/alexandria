// Admin route group entry point.
//
// The mount and the code-split boundary are owned by node G1.10; the
// screens themselves are owned by node G1.11 (login, upload) and later by
// G2.5 and G3.5.
//
// This module exists as its own chunk on purpose: React Router lazy-loads
// it, so opening the public Library never downloads a byte of admin code
// (TECHSTACK.md §22, AGENT.md §25). Keep every admin screen behind this
// boundary.
export function AdminRoot() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="font-serif text-2xl text-stone-900">Admin</h1>
      <p className="mt-2 text-sm text-stone-600">
        Sign-in and upload arrive with node G1.11.
      </p>
    </main>
  );
}

export default AdminRoot;
