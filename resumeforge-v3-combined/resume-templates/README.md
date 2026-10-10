# ResumeForge — 8 Professional LaTeX Resume Templates

This package contains the **8** ResumeForge templates that ship with the app, as
real, compilable LaTeX projects. Every template ships with a pre-compiled PDF
preview and, where an upstream class is required, the class file and fonts it
needs.

## Template list, engine and upstream class

| # | Template | Engine | Class / base |
|---|---|---|---|
| 04 | ModernCV Classic | pdfLaTeX | `moderncv.cls` + `moderncvstyleclassic` |
| 09 | Minimal Clean Tech | pdfLaTeX | article |
| 10 | FAANG-Style Compact | pdfLaTeX | article |
| 12 | Bold Header Modern | pdfLaTeX | article |
| 13 | Ultra-Clean One-Page | pdfLaTeX | article |
| 14 | Premium Minimalist | pdfLaTeX | article |
| 15 | Tech-Focused Dense | pdfLaTeX | article |
| 20 | Structured Executive Brief | pdfLaTeX | article (mathpazo) |

The app's live renderers (under
`supabase/functions/generate-resume/latex/templates/`) drive the same layouts
dynamically off the canonical Resume JSON; `main.tex` in each folder is a static
example resume in that template's style.

## Build instructions

Each folder is an independent project — compile inside the folder:

```bash
pdflatex -interaction=nonstopmode -halt-on-error main.tex
```

All 8 templates are pdfLaTeX. None depend on `lmodern` or `fontawesome5`
(confirmed missing in this pack's own build environment) — they use base LaTeX
Computer Modern or `mathpazo`, both always available with a standard TeX Live
install. Template 20 uses `mathpazo` (Palatino).

## Folder structure

```
04-moderncv-classic/            main.tex (uses TeX Live moderncv)
09-minimal-clean-tech/          main.tex (self-contained article)
10-faang-style-compact/         main.tex (self-contained article)
12-bold-header-modern/          main.tex (self-contained article)
13-ultra-clean-one-page/        main.tex (self-contained article)
14-premium-minimalist/          main.tex (self-contained article)
15-tech-focused-dense/          main.tex (self-contained article)
20-structured-executive-brief/  main.tex (self-contained article)
previews/                       rendered page-1 PNG of every template
*.pdf                           compiled output per folder
```
