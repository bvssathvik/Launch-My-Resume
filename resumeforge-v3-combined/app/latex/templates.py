"""The 8 LaTeX templates — verbatim ports of latex/templates/*.ts.

Each template is a function over a `sections` dict with keys:
header, summary, experience, education, skills, projects (str|None),
certifications (str|None), additional_sections (str|None).
Empty/None sections are rendered as "" by build_latex and dropped here via
the same conditional pattern the TypeScript used (a section only appears
if its content is truthy).
"""
from __future__ import annotations


def _summary_block(sections: dict, title: str = "Summary") -> str:
    return f"\\section{{{title}}}\n\\noindent {sections['summary']}\n" if sections.get("summary") else ""


def _education_block(sections: dict) -> str:
    return f"\\section{{Education}}\n{sections['education']}\n" if sections.get("education") else ""


def _experience_block(sections: dict) -> str:
    return f"\\section{{Experience}}\n{sections['experience']}\n" if sections.get("experience") else ""


def _projects_block(sections: dict) -> str:
    return f"\\section{{Projects}}\n{sections['projects']}\n" if sections.get("projects") else ""


def _skills_block(sections: dict, title: str = "Skills") -> str:
    return f"\\section{{{title}}}\n{sections['skills']}\n" if sections.get("skills") else ""


def _certs_block(sections: dict, title: str = "Certifications") -> str:
    return f"\\section{{{title}}}\n{sections['certifications']}\n" if sections.get("certifications") else ""


def _head(sections: dict) -> str:
    return sections["header"]


MODERNCV = r"""\documentclass[11pt,a4paper]{article}
\usepackage[margin=0.75in]{geometry}
\usepackage{xcolor}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage[T1]{fontenc}
% NOTE: lmodern intentionally NOT used — it isn't guaranteed to be present
% on every LaTeX install (confirmed missing even in local testing), and
% \sfdefault/\rmdefault already resolve to Computer Modern Sans/Roman,
% which ship with base LaTeX and need no extra package.

\definecolor{modernblue}{HTML}{3873B3}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\raggedbottom

	itleformat{\section}{\Large\bfseries\color{modernblue}}{}{0em}{}[\vspace{-5pt}{\color{modernblue}\titlerule[1pt]}\vspace{4pt}]
\titlespacing{\section}{0pt}{10pt}{4pt}
\setlist[itemize]{leftmargin=0.18in,label={\color{modernblue}\textbullet},itemsep=1pt,topsep=2pt}

\begin{document}

__HEADER__

__SUMMARY__

__EDUCATION__

__EXPERIENCE__

__PROJECTS__

__SKILLS__

__CERTS__


__ADDITIONAL__

\end{document}"""


def moderncv_classic(sections: dict) -> str:
    return (
        MODERNCV
        .replace("__HEADER__", _head(sections))
        .replace("__SUMMARY__", _summary_block(sections))
        .replace("__EDUCATION__", _education_block(sections))
        .replace("__EXPERIENCE__", _experience_block(sections))
        .replace("__PROJECTS__", _projects_block(sections))
        .replace("__SKILLS__", _skills_block(sections, title="Technical Skills"))
        .replace("__CERTS__", _certs_block(sections, title="Achievements"))
        .replace("__ADDITIONAL__", sections.get("additional_sections") or "")
    )


MINIMAL_CLEAN_TECH = r"""\documentclass[10.5pt,a4paper]{article}
\usepackage[margin=0.65in]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\usepackage{xcolor}
\usepackage[T1]{fontenc}
% NOTE: lmodern intentionally NOT used — it isn't guaranteed to be present
% on every LaTeX install (confirmed missing even in local testing), and
% \sfdefault/\rmdefault already resolve to Computer Modern Sans/Roman,
% which ship with base LaTeX and need no extra package.
\renewcommand{\familydefault}{\sfdefault}

\definecolor{mctgray}{HTML}{2B2B2B}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\raggedbottom

\titleformat{\section}{\bfseries\large\color{mctgray}}{}{0em}{}[\vspace{-5pt}{\color{mctgray!60}\titlerule[0.5pt]}\vspace{3pt}]
\titlespacing{\section}{0pt}{11pt}{4pt}
\setlist[itemize]{leftmargin=0.18in,itemsep=1pt,topsep=2pt}

\begin{document}

__HEADER__

__SUMMARY__

__EDUCATION__

__EXPERIENCE__

__PROJECTS__

__SKILLS__

__CERTS__


__ADDITIONAL__

\end{document}"""


def minimal_clean_tech(sections: dict) -> str:
    return (
        MINIMAL_CLEAN_TECH
        .replace("__HEADER__", _head(sections))
        .replace("__SUMMARY__", _summary_block(sections))
        .replace("__EDUCATION__", _education_block(sections))
        .replace("__EXPERIENCE__", _experience_block(sections))
        .replace("__PROJECTS__", _projects_block(sections))
        .replace("__SKILLS__", _skills_block(sections))
        .replace("__CERTS__", _certs_block(sections))
        .replace("__ADDITIONAL__", sections.get("additional_sections") or "")
    )


FAANG_STYLE_COMPACT = r"""\documentclass[10pt,a4paper]{article}
\usepackage[margin=0.5in]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\usepackage[T1]{fontenc}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlist[itemize]{leftmargin=*,itemsep=1pt,topsep=2pt}

	itleformat{\section}{\bfseries\uppercase}{}{0em}{}[\rule{\linewidth}{0.8pt}]
	itlespacing{\section}{0pt}{6pt}{2pt}

\begin{document}

__HEADER__
\vspace{2pt}

__SUMMARY__

__EDUCATION__

__EXPERIENCE__

__PROJECTS__

__SKILLS__

__CERTS__


__ADDITIONAL__

\end{document}"""


def faang_style_compact(sections: dict) -> str:
    return (
        FAANG_STYLE_COMPACT
        .replace("__HEADER__", _head(sections))
        .replace("__SUMMARY__", _summary_block(sections))
        .replace("__EDUCATION__", _education_block(sections))
        .replace("__EXPERIENCE__", _experience_block(sections))
        .replace("__PROJECTS__", _projects_block(sections))
        .replace("__SKILLS__", _skills_block(sections))
        .replace("__CERTS__", _certs_block(sections, title="Achievements"))
        .replace("__ADDITIONAL__", sections.get("additional_sections") or "")
    )


BOLD_HEADER_MODERN = r"""\documentclass[10pt,a4paper]{article}
\usepackage[margin=0.5in]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\usepackage{xcolor}
\usepackage[T1]{fontenc}
% NOTE: lmodern intentionally NOT used — it isn't guaranteed to be present
% on every LaTeX install (confirmed missing even in local testing), and
% \sfdefault/\rmdefault already resolve to Computer Modern Sans/Roman,
% which ship with base LaTeX and need no extra package.
\renewcommand{\familydefault}{\sfdefault}

\definecolor{bhmnavy}{HTML}{14345A}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlist[itemize]{leftmargin=*,itemsep=1pt,topsep=2pt,label={\color{bhmnavy}\textbullet}}

\titleformat{\section}{\bfseries\color{bhmnavy}\large}{}{0em}{}[\titlerule]
\\titlespacing{\section}{0pt}{6pt}{2pt}

\begin{document}

\noindent\colorbox{bhmnavy}{\parbox{\dimexpr\textwidth-2\fboxsep\relax}{\color{white}
__HEADER__
}}
\vspace{8pt}

__SUMMARY__

__EDUCATION__

__EXPERIENCE__

__PROJECTS__

__SKILLS__

__CERTS__


__ADDITIONAL__

\end{document}"""


def bold_header_modern(sections: dict) -> str:
    return (
        BOLD_HEADER_MODERN
        .replace("__HEADER__", _head(sections))
        .replace("__SUMMARY__", _summary_block(sections))
        .replace("__EDUCATION__", _education_block(sections))
        .replace("__EXPERIENCE__", _experience_block(sections))
        .replace("__PROJECTS__", _projects_block(sections))
        .replace("__SKILLS__", _skills_block(sections))
        .replace("__CERTS__", _certs_block(sections, title="Achievements"))
        .replace("__ADDITIONAL__", sections.get("additional_sections") or "")
    )


ULTRA_CLEAN_ONE_PAGE = r"""\documentclass[10pt,a4paper]{article}
\usepackage[margin=0.5in]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\usepackage[T1]{fontenc}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlist[itemize]{leftmargin=0.18in,itemsep=0.5pt,topsep=1pt,parsep=0pt}

	itleformat{\section}{\bfseries}{}{0em}{}[\rule{\linewidth}{0.4pt}]
	itlespacing{\section}{0pt}{6pt}{2pt}

\begin{document}

__HEADER__

__SUMMARY__

__EDUCATION__

__EXPERIENCE__

__PROJECTS__

__SKILLS__

__CERTS__


__ADDITIONAL__

\end{document}"""


def ultra_clean_one_page(sections: dict) -> str:
    return (
        ULTRA_CLEAN_ONE_PAGE
        .replace("__HEADER__", _head(sections))
        .replace("__SUMMARY__", _summary_block(sections))
        .replace("__EDUCATION__", _education_block(sections))
        .replace("__EXPERIENCE__", _experience_block(sections))
        .replace("__PROJECTS__", _projects_block(sections))
        .replace("__SKILLS__", _skills_block(sections))
        .replace("__CERTS__", _certs_block(sections))
        .replace("__ADDITIONAL__", sections.get("additional_sections") or "")
    )


TECH_FOCUSED_DENSE = r"""\documentclass[9.5pt,a4paper]{article}
\usepackage[margin=0.45in]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\usepackage[T1]{fontenc}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlist[itemize]{leftmargin=0.15in,itemsep=0.5pt,topsep=1pt,parsep=0pt}
    	itleformat{\section}{\bfseries}{}{0em}{}[\rule{\linewidth}{0.4pt}]
    	itlespacing{\section}{0pt}{6pt}{2pt}
\\titlespacing{\section}{0pt}{6pt}{2pt}

\begin{document}

__HEADER__

__SUMMARY__

__EDUCATION__

__EXPERIENCE__

__PROJECTS__

__SKILLS__

__CERTS__

__ADDITIONAL__

\end{document}"""


def tech_focused_dense(sections: dict) -> str:
    skills = f"\\section{{Skills}}\n{{\\ttfamily\\small\\raggedright\\sloppy {sections['skills']}\\par}}\n" if sections.get("skills") else ""
    return (
        TECH_FOCUSED_DENSE
        .replace("__HEADER__", _head(sections))
        .replace("__SUMMARY__", _summary_block(sections))
        .replace("__EDUCATION__", _education_block(sections))
        .replace("__EXPERIENCE__", _experience_block(sections))
        .replace("__PROJECTS__", _projects_block(sections))
        .replace("__SKILLS__", skills)
        .replace("__CERTS__", _certs_block(sections, title="Achievements"))
        .replace("__ADDITIONAL__", sections.get("additional_sections") or "")
    )


PREMIUM_MINIMALIST = r"""\documentclass[11pt,a4paper]{article}
\usepackage[margin=0.75in]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\usepackage{xcolor}
\usepackage[T1]{fontenc}

\linespread{1.08}
\definecolor{pmgray}{HTML}{333333}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\raggedbottom

	itleformat{\section}{\large\scshape\color{pmgray}}{}{0em}{}[\vspace{1pt}\titlerule[0.3pt]]
\titlespacing{\section}{0pt}{13pt}{6pt}
\setlist[itemize]{leftmargin=0.22in,itemsep=2pt,topsep=2pt}

\begin{document}

__HEADER__

__SUMMARY__

__EDUCATION__

__EXPERIENCE__

__PROJECTS__

__SKILLS__

__CERTS__


__ADDITIONAL__

\end{document}"""


def premium_minimalist(sections: dict) -> str:
    return (
        PREMIUM_MINIMALIST
        .replace("__HEADER__", _head(sections))
        .replace("__SUMMARY__", _summary_block(sections))
        .replace("__EDUCATION__", _education_block(sections))
        .replace("__EXPERIENCE__", _experience_block(sections))
        .replace("__PROJECTS__", _projects_block(sections))
        .replace("__SKILLS__", _skills_block(sections))
        .replace("__CERTS__", _certs_block(sections))
        .replace("__ADDITIONAL__", sections.get("additional_sections") or "")
    )


STRUCTURED_EXECUTIVE_BRIEF = r"""\documentclass[11pt,letterpaper]{article}
\usepackage[margin=0.75in]{geometry}
\usepackage[T1]{fontenc}
\usepackage{mathpazo}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\usepackage{xcolor}

\definecolor{sebnavy}{HTML}{1C2B39}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\raggedbottom
\setlist[itemize]{leftmargin=1.2em,itemsep=2pt,topsep=3pt}

	itleformat{\section}{\bfseries\color{sebnavy}}{}{0em}{}[\vspace{-3pt}{\color{sebnavy}\rule{\linewidth}{0.9pt}}\vspace{0.5pt}\titlerule[0.4pt]]
\titlespacing{\section}{0pt}{11pt}{5pt}

\begin{document}

__HEADER__

__SUMMARY__

__EXPERIENCE__

__EDUCATION__

__PROJECTS__

__SKILLS__

__CERTS__


__ADDITIONAL__

\end{document}"""


def structured_executive_brief(sections: dict) -> str:
    return (
        STRUCTURED_EXECUTIVE_BRIEF
        .replace("__HEADER__", _head(sections))
        .replace("__SUMMARY__", _summary_block(sections))
        .replace("__EXPERIENCE__", _experience_block(sections))
        .replace("__EDUCATION__", _education_block(sections))
        .replace("__PROJECTS__", _projects_block(sections))
        .replace("__SKILLS__", _skills_block(sections))
        .replace("__CERTS__", _certs_block(sections))
        .replace("__ADDITIONAL__", sections.get("additional_sections") or "")
    )
