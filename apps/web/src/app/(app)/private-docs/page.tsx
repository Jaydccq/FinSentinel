'use client';

import { PrivateDocsPanel } from '@/components/private-docs';

export default function PrivateDocsPage() {
  return (
    <div className="container mx-auto max-w-4xl py-8">
      <h1 className="mb-6 text-2xl font-bold">Private Documents</h1>
      <PrivateDocsPanel />
    </div>
  );
}
