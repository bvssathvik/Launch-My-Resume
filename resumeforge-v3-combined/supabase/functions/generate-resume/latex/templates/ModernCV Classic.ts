export function modernCvClassicTemplate(sections: {
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
\\usepackage{xcolor}
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage[T1]{fontenc}
% NOTE: lmodern intentionally NOT used — it isn't guaranteed to be present
% on every LaTeX install (confirmed missing even in local testing), and
% \\sfdefault/\\rmdefault already resolve to Computer Modern Sans/Roman,
% which ship with base LaTeX and need no extra package.

\\definecolor{modernblue}{HTML}{3873B3}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\raggedbottom

\\titleformat{\\section}{\\Large\\bfseries\\color{modernblue}}{}{0em}{}[\\vspace{-5pt}{\\color{modernblue}\\titlerule[1pt]}\\vspace{4pt}]
\\titlespacing{\\section}{0pt}{10pt}{4pt}
\\setlist[itemize]{leftmargin=0.18in,label={\\color{modernblue}\\textbullet},itemsep=1pt,topsep=2pt}

\\begin{document}

${sections.header}

${sections.summary ? `\\section{Summary}\n\\noindent ${sections.summary}\n\n` : ""}

${sections.education ? `\\section{Education}\n${sections.education}\n` : ""}

${sections.experience ? `\\section{Experience}\n${sections.experience}\n` : ""}

${sections.projects ? `\\section{Projects}\n${sections.projects}\n\n` : ""}

${sections.skills ? `\\section{Technical Skills}\n${sections.skills}\n` : ""}

${sections.certifications ? `\\section{Achievements}\n${sections.certifications}\n` : ""}


${sections.additionalSections || ""}

\\end{document}`;
}

