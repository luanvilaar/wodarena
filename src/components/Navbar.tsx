'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Calendar, ChevronDown, Globe2, LayoutDashboard, Menu, X } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-card-border bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="group flex min-w-0 items-center gap-2.5" onClick={closeMenu} aria-label="WODArena - página inicial">
            <BrandLogo className="h-11 w-11 rounded-sm border border-card-border transition-transform group-hover:scale-[1.02]" priority />
            <Image
              src="/Ativo_1.svg"
              alt="WODArena"
              width={140}
              height={18}
              priority
              className="h-4.5 w-auto object-contain shrink-0"
            />
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Navegação principal">
            <Link
              href="/"
              className="flex h-10 items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-white"
            >
              <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>Eventos</span>
            </Link>

            <span className="flex h-10 items-center gap-1 text-sm font-semibold text-muted">
              <Globe2 className="h-4 w-4" aria-hidden="true" />
              <span>PT</span>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </span>
            <Link
              href="/admin"
              className="flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              <span>Painel Admin</span>
            </Link>
          </nav>

          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-card-border bg-card text-white transition-colors hover:border-primary md:hidden"
            aria-label={isMenuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            {isMenuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <nav className="border-t border-card-border bg-background px-4 py-5 md:hidden" aria-label="Navegação mobile">
          <div className="mx-auto flex max-w-7xl flex-col gap-2">
            <Link href="/" onClick={closeMenu} className="flex h-12 items-center gap-3 rounded-md px-3 text-sm font-semibold text-white hover:bg-card">
              <Calendar className="h-4 w-4 text-primary" aria-hidden="true" /> Eventos
            </Link>

            <Link href="/admin" onClick={closeMenu} className="mt-3 flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-ink hover:bg-primary-hover">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Painel Admin
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
