'use client';

import React from 'react';
import { SectionOperations } from '@/components/home/SectionOperations';
import { ProductStory } from '@/components/home/ProductStory';
import { CommercialLeadForm } from '@/components/home/CommercialLeadForm';

export function OrganizersView() {
  return (
    <div className="min-h-screen bg-background">
      <SectionOperations />
      <ProductStory />
      <section id="contato" className="border-t border-card-border">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <CommercialLeadForm />
        </div>
      </section>
    </div>
  );
}
