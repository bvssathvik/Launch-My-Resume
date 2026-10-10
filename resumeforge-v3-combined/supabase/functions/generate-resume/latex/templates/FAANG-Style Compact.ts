// ─────────────────────────────────────────
// FAANG-Style Compact
// Dense single column with bold uppercase headers under a full-width
// rule and very tight list spacing. Distinct from the existing
// FAANGPath Simple template (which is deliberately undecorated with no
// rule at all) by its bolder headers and Achievements section.
// (The former FAANGPath Simple template was removed from the set.)
// ─────────────────────────────────────────

export function faangStyleCompactTemplate(sections: {
  header: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  projects?: string;
  certifications?: string;
  additionalSections?: string;
}): string {
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=0.5in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}
\\usepackage[T1]{fontenc}

\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlist[itemize]{leftmargin=*,itemsep=1pt,topsep=2pt}

\\titleformat{\\section}{\\bfseries\\uppercase}{}{0em}{}[\\rule{\\linewidth}{0.8pt}]
\\titlespacing{\\section}{0pt}{6pt}{2pt}

\\begin{document}

${sections.header}
\\vspace{2pt}

${sections.summary ? `\\section{Summary}\n\\noindent ${sections.summary}\n` : ""}

${sections.education ? `\\section{Education}\n${sections.education}\n` : ""}

${sections.experience ? `\\section{Experience}\n${sections.experience}\n` : ""}

${sections.projects ? `\\section{Projects}\n${sections.projects}\n` : ""}

${sections.skills ? `\\section{Skills}\n${sections.skills}\n` : ""}

${sections.certifications ? `\\section{Achievements}\n${sections.certifications}\n` : ""}


${sections.additionalSections || ""}

\\end{document}`;
}
