// ─────────────────────────────────────────
// Premium Minimalist
// Single column, the most generous margins and airiest spacing of the
// set (\linespread instead of the `setspace` package — a native LaTeX
// command, no extra dependency), thin hairline rules, light-touch small
// caps section headers. Meant to feel unhurried rather than dense.
// ─────────────────────────────────────────

export function premiumMinimalistTemplate(sections: {
  header: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  projects?: string;
  certifications?: string;
  additionalSections?: string;
}): string {
  return `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=0.75in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}
\\usepackage{xcolor}
\\usepackage[T1]{fontenc}

\\linespread{1.08}
\\definecolor{pmgray}{HTML}{333333}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\raggedbottom

\\titleformat{\\section}{\\large\\scshape\\color{pmgray}}{}{0em}{}[\\vspace{1pt}\\titlerule[0.3pt]]
\\titlespacing{\\section}{0pt}{13pt}{6pt}
\\setlist[itemize]{leftmargin=0.22in,itemsep=2pt,topsep=2pt}

\\begin{document}

${sections.header}

${sections.summary ? `\\section{Summary}\n\\noindent ${sections.summary}\n` : ""}

${sections.education ? `\\section{Education}\n${sections.education}\n` : ""}

${sections.experience ? `\\section{Experience}\n${sections.experience}\n` : ""}

${sections.projects ? `\\section{Projects}\n${sections.projects}\n` : ""}

${sections.skills ? `\\section{Skills}\n${sections.skills}\n` : ""}

${sections.certifications ? `\\section{Certifications}\n${sections.certifications}\n` : ""}


${sections.additionalSections || ""}

\\end{document}`;
}
