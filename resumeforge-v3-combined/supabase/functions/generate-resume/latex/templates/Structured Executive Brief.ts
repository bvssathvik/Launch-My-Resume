// ─────────────────────────────────────────
// Structured Executive Brief
// Single column, mathpazo serif, centered header, and a double hairline
// rule (bold + thin) under each navy section heading — generous spacing
// aimed at senior/executive candidates who want gravitas without color
// blocks or a sidebar. No tables, no icons, no text boxes.
// ─────────────────────────────────────────

export function structuredExecutiveBriefTemplate(sections: {
  header: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  projects?: string;
  certifications?: string;
  additionalSections?: string;
}): string {
  return `\\documentclass[11pt,letterpaper]{article}
\\usepackage[margin=0.75in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{mathpazo}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}
\\usepackage{xcolor}

\\definecolor{sebnavy}{HTML}{1C2B39}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\raggedbottom
\\setlist[itemize]{leftmargin=1.2em,itemsep=2pt,topsep=3pt}

\\titleformat{\\section}{\\bfseries\\color{sebnavy}}{}{0em}{}[\\vspace{-3pt}{\\color{sebnavy}\\rule{\\linewidth}{0.9pt}}\\vspace{0.5pt}\\titlerule[0.4pt]]
\\titlespacing{\\section}{0pt}{11pt}{5pt}

\\begin{document}

${sections.header}

${sections.summary ? `\\section{Summary}\n\\noindent ${sections.summary}\n` : ""}

${sections.experience ? `\\section{Experience}\n${sections.experience}\n` : ""}

${sections.education ? `\\section{Education}\n${sections.education}\n` : ""}

${sections.projects ? `\\section{Projects}\n${sections.projects}\n` : ""}

${sections.skills ? `\\section{Skills}\n${sections.skills}\n` : ""}

${sections.certifications ? `\\section{Certifications}\n${sections.certifications}\n` : ""}


${sections.additionalSections || ""}

\\end{document}`;
}
