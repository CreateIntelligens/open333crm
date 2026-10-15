'use client';

import Script from 'next/script';
import { createElement, useState } from 'react';

export default function ApiReferenceViewer() {
  const [scriptFailed, setScriptFailed] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  return (
    <>
      <Script
        src="https://cdn.redoc.ly/redoc/v2.x/bundles/redoc.standalone.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() => setScriptFailed(true)}
      />
      {scriptFailed ? (
        <p role="alert" className="m-8 rounded border border-red-300 bg-red-50 p-4 text-red-900">
          The API reference viewer could not load. Check the Redoc script connection and reload this page.
        </p>
      ) : (
        <>
          {!scriptLoaded && <p role="status" className="px-6 py-8 text-sm text-slate-600">Loading API reference…</p>}
          {createElement('redoc', { 'spec-url': '/openapi.json' })}
        </>
      )}
    </>
  );
}
