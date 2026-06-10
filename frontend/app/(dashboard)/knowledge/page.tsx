'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Badge, { StatusBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import Spinner, { PageLoader } from '@/components/Spinner';
import type { KbChatResponse, KbDocument } from '@/lib/types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

export default function KnowledgePage() {
  const toast = useToast();
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDocs(await api.get<KbDocument[]>('/api/v1/kb/documents'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file);
        await api.upload<KbDocument>('/api/v1/kb/upload', fd);
      }
      toast.success(
        list.length === 1
          ? `Uploaded ${list[0].name}`
          : `Uploaded ${list.length} documents`
      );
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (doc: KbDocument) => {
    if (!confirm(`Delete "${doc.filename}"?`)) return;
    try {
      await api.delete(`/api/v1/kb/documents/${doc.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success('Document deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete document');
    }
  };

  const ask = async () => {
    const q = query.trim();
    if (!q) return;
    setChat((prev) => [...prev, { role: 'user', content: q }]);
    setQuery('');
    setAsking(true);
    try {
      const res = await api.post<KbChatResponse>('/api/v1/kb/chat', { query: q });
      setChat((prev) => [
        ...prev,
        { role: 'assistant', content: res.answer, sources: res.sources },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'KB chat failed');
      setChat((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry — I could not answer that right now. Please try again.',
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Knowledge base</h1>
        <p className="text-sm text-slate-500">
          Upload product docs, case studies and battle cards — the AI cites them when
          drafting and handling objections.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {/* Upload zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              uploadFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${
              dragOver
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40'
            }`}
          >
            {uploading ? (
              <>
                <Spinner size="lg" />
                <p className="mt-3 text-sm text-slate-500">Uploading…</p>
              </>
            ) : (
              <>
                <span className="text-3xl">📚</span>
                <p className="mt-2 text-sm font-medium text-slate-700">
                  Drag & drop files here, or click to browse
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  PDF, DOCX, TXT, MD — indexed for retrieval automatically
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {/* Document list */}
          <div className="mt-4">
            {loading ? (
              <PageLoader label="Loading documents…" />
            ) : docs.length === 0 ? (
              <EmptyState
                icon="🗂️"
                title="No documents yet"
                description="Upload your first document to give the AI context about your product and customers."
              />
            ) : (
              <ul className="space-y-2">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <span className="text-xl">📄</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {doc.filename}
                      </p>
                      <p className="text-xs text-slate-400">
                        {doc.file_type.toUpperCase()} · {formatBytes(doc.file_size)} ·{' '}
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusBadge status={doc.upload_status} />
                    <Badge
                      color={
                        doc.vector_status === 'indexed'
                          ? 'green'
                          : doc.vector_status === 'failed'
                            ? 'red'
                            : 'amber'
                      }
                    >
                      {doc.vector_status === 'indexed'
                        ? 'Indexed'
                        : doc.vector_status === 'failed'
                          ? 'Index failed'
                          : 'Indexing…'}
                    </Badge>
                    <button
                      onClick={() => deleteDoc(doc)}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* KB test chat */}
        <div className="flex h-[520px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Test the knowledge base</p>
            <p className="text-xs text-slate-500">
              Ask a question to see what the AI retrieves.
            </p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {chat.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-400">
                e.g. “What ROI did our fintech customers see?”
              </p>
            )}
            {chat.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'rounded-br-sm bg-indigo-600 text-white'
                      : 'rounded-bl-sm bg-slate-100 text-slate-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.sources.map((s, j) => (
                        <Badge key={j} color="indigo">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {asking && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
                  <Spinner size="sm" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="flex gap-2 border-t border-slate-200 p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ask();
              }}
              placeholder="Ask the knowledge base…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <button
              onClick={ask}
              disabled={asking || !query.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Ask
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
