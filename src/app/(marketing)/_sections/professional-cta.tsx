import { CheckCircle2 } from "lucide-react";

import { ButtonLink } from "@/components/ui/button-link";

const BENEFITS = [
  "Recibe solicitudes de clientes que buscan tu categoría de servicio",
  "Crea tu perfil profesional y muestra tu experiencia y portfolio",
  "Envía presupuestos directamente desde tu panel",
  "Gestiona citas y trabajos de principio a fin",
  "Construye tu reputación con las opiniones de tus clientes",
] as const;

export function ProfessionalCta() {
  return (
    <section className="bg-foreground text-background">
      <div className="container flex flex-col gap-8 py-16 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-xl flex-col gap-5">
          <span className="w-fit rounded-full bg-background/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-background/80">
            Para profesionales
          </span>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            ¿Eres profesional? Consigue nuevos clientes con MaestroYa
          </h2>
          <ul className="flex flex-col gap-2.5">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2.5 text-sm text-background/85">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                {benefit}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col">
          <ButtonLink href="/auth/register" variant="accent" size="lg">
            Unirme como profesional
          </ButtonLink>
          <ButtonLink
            href="/auth/login"
            variant="outline"
            size="lg"
            className="border-background/30 bg-transparent text-background hover:bg-background/10"
          >
            Ya tengo cuenta
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
