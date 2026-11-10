import { extractFromText, readCv } from '../src/candidates/cv-extractor';
import { layoutPdf, PdfItem } from '../src/candidates/pdf-layout';

// Made-up people in the layouts of real CVs that came in (Bdjobs export, two-column designs, labelled HR CVs).
// Real CVs are personal data and are not kept in the repository.
const TODAY = new Date(Date.UTC(2026, 10, 5));

describe('CV extraction: Bdjobs export', () => {
  const cv = [
    'Source: Bdjobs.com Online Talent Search',
    'Job Title: Manager - QC (RMG Washing Plant)',
    'Last Updated: 4 Feb 2026',
    'MD. KAMAL HOSSAIN',
    'Ward -08 Boat mill, Shafipur, Kaliakair,',
    'Gazipur 1751',
    '01711000111, 01811000222',
    'kamal.h@example.com',
    'Career Summary:',
    'Over 11 years of hands on experience in cutting section operations.',
    'Employment History:',
    'Total year of experience: 19.9 yrs',
    '1. Deputy Manager (9.1yrs)',
    '(5 Oct 2017 - Continuing)',
    'Delta Textile (BD) Ltd.',
    'Area of Expertise:',
    'Quality Management (8.3 yr)',
    'Duties/Responsibilities',
    'Decision Maker',
    '2. Supervisor To In-charge (7.0yrs)',
    '(10 Oct 2010 - 21 Sep 2017)',
    'Echo Washing Plant',
    'Area of Expertise:',
    'Communication (4.3 yr), Analytical Skill (4.7 yr)',
    'Academic Qualification:',
    'Exam Title: PGD | Concentration/Major: Textile Industry Management | Institute: Bangladesh University of Textiles | Result: Enrolled | Pass.Year: 2027',
    'Exam Title: Bachelor of Science (BSc) | Concentration/Major: Textile Engineering | Institute: University of South Asia | Result: CGPA : 2.68 (out of 4) | Pass.Year: 2017 | Duration: 04 Years',
    'Exam Title: HSC | Concentration/Major: Science | Institute: BCIC College, Dhaka | Result: CGPA : 3.4 (out of 5) | Pass.Year: 2008',
    'Training Summary:',
    'Training Title: Cutting Team Leadership | Topic: Leadership | Institute: New Asia Group | Country: Bangladesh | Year: 2023 | Duration: 01Month',
    'Professional Qualification:',
    'Certification: SROMIC SIKKA COURSE | Institute: Ministry of Labour and Employment | Location: Dhaka | From: May 18, 2024 | To: May 23, 2024',
    'Career and Application Information:',
    'Present Salary : 75000',
    'Expected Salary : 90000',
    'Skills:',
    'Fields of Skill\tDescription',
    '• Textile quality management\t<p>Textile Testing </p><p>Physical &amp;',
    '• Internal Audit\tChemical Testing</',
    'Personal Details:',
    "Father's Name : Abdus Samad",
    "Mother's Name : Amena Begum",
    'Date of Birth : 1 Jan 1985',
    'Permanent Address : Charishimul, Dhanbari, Tangail',
    'Reference (s):',
    'Name : Md Noyon Hossain',
    'Organization : NRN GROUP',
    'Designation : AGM Production',
    'Primary Mobile No : 01637000000',
    'Primary Email : referee@example.com',
  ].join('\n');
  const ex = extractFromText(cv, { today: TODAY });

  it('takes the candidate, not the father or the referee', () => {
    expect(ex.name).toBe('MD. KAMAL HOSSAIN');
    expect(ex.email).toBe('kamal.h@example.com');
    expect(ex.phone).toBe('01711000111');
    expect(ex.address).toBe('Ward -08 Boat mill, Shafipur, Kaliakair, Gazipur 1751');
    expect(ex.age).toBe(41);
    expect(ex.expectedSalary).toBe('90000');
  });

  it('reads the jobs held, not the post applied for or the referee', () => {
    expect(ex.totalExperienceYears).toBe(19.9); // the stated total, not "over 11 years" in the summary
    expect(ex.lastPosition).toBe('Deputy Manager');
    expect(ex.workplace).toBe('Delta Textile (BD) Ltd.');
    expect(ex.previousJobs).toBe('Deputy Manager, Delta Textile (BD) Ltd. (5 Oct 2017 – Continuing)\nSupervisor To In-charge, Echo Washing Plant (10 Oct 2010 – 21 Sep 2017)');
  });

  it('reads the highest finished degree with its own subject, institute and CGPA', () => {
    expect(ex.degree).toBe('Bachelor of Science (BSc)'); // the enrolled PGD does not count yet
    expect(ex.specialization).toBe('Textile Engineering');
    expect(ex.institution).toBe('University of South Asia');
    expect(ex.cgpa).toBe(2.68);
    expect(ex.cgpaRaw).toBe('CGPA : 2.68 (out of 4)');
    expect(ex.education).toContain('HSC, Science - BCIC College, Dhaka');
  });

  it('reads skills, expertise and trainings without the HTML description', () => {
    expect(ex.skills).toBe('Textile quality management, Internal Audit, Quality Management, Communication, Analytical Skill');
    expect(ex.certifications).toBe('Cutting Team Leadership (New Asia Group, 2023); SROMIC SIKKA COURSE (Ministry of Labour and Employment, 2024)');
  });

  it('does not turn a GPA out of 5 into a CGPA', () => {
    const hsc = extractFromText('Rina Akter\nAcademic Qualification:\nExam Title: HSC | Concentration/Major: Science | Institute: BCIC College | Result: CGPA : 3.4 (out of 5) | Pass.Year: 2008');
    expect(hsc.degree).toBe('HSC');
    expect(hsc.cgpaRaw).toBe('CGPA : 3.4 (out of 5)');
    expect(hsc.cgpa).toBeNull();
  });
});

describe('CV extraction: designed CVs', () => {
  it('reads a sidebar CV whose jobs are written as company / group / title under a date', () => {
    const ex = extractFromText([
      'CONTACT ME', '+8801892-000111', 'rafiq.ahmed@example.com', 'Auchpara,Tongi,Gazipur',
      'SKILLS', 'Microsoft Office', 'Time Management',
      'TRAINING', 'Firefighting, Fire Prevention,', 'Rescue and First Aider Training.', 'Social Compliance &', 'Environmental Management', '(SICIP-BGMEA)',
      'REFERENCES', 'Abu Rayhan', 'AGM Admin', 'Phone: +8801788-000000',
      'RAFIQ AHMED', 'Administrative Officer',
      'EXPERIENCE', 'Creative Wash Ltd - 01\t2022-Till Now', 'Ha-Meem Group', 'Administrative Officer',
      'Denitex Wash Ltd\t2021-2022', 'Armana Group', 'Administrative Officer',
      'EDUCATION', 'Bachelor of Arts (Honours), English', 'Uttara Town College', 'CGPA 2.53 / 4.00',
      'Higher Secondary Certificate (HSC), Science', 'Gulshan Model High School & College', 'GPA 3.92 / 5.00',
    ].join('\n'), { nameHint: 'RAFIQ AHMED' });
    expect(ex).toMatchObject({
      name: 'RAFIQ AHMED', phone: '01892000111', address: 'Auchpara,Tongi,Gazipur',
      degree: 'Bachelor of Arts (Honours)', specialization: 'English', institution: 'Uttara Town College', cgpa: 2.53,
      lastPosition: 'Administrative Officer', workplace: 'Creative Wash Ltd - 01 (Ha-Meem Group)',
      skills: 'Microsoft Office, Time Management',
      certifications: 'Firefighting, Fire Prevention, Rescue and First Aider Training.; Social Compliance & Environmental Management (SICIP-BGMEA)',
    });
    expect(ex.previousJobs).toBe('Administrative Officer, Creative Wash Ltd - 01 (Ha-Meem Group) (2022 – Till Now)\nAdministrative Officer, Denitex Wash Ltd (Armana Group) (2021 – 2022)');
  });

  it('reads letter-spaced headings, "Company | Title" jobs and an institute written above the degree', () => {
    const ex = extractFromText([
      'SHAHED KARIM', 'SR MANAGER | DESIGN & PD', 'Address', 'Present: H-1, R-2/A, Sector-3,', 'Uttara 1230, Dhaka, Bangladesh',
      'Phone', '+8801784000 102', 'shahed@example.com',
      'E X P E R I E N C E S', 'LANTABUR GROUP | SR MANAGER | DESIGN & PD\t/ 2025 to Present',
      'Leading a creative team, I drive trend research and market analysis.',
      'BEXIMCO | MANAGER | DESIGN & PD\t/ 2017 to 2024', 'I analyze market trends and create product concepts and tech packs,and',
      'E D U C A T I O N\t/ 2018 - 2019', 'SHANTO-MARIAM UNIVERSITY OF CREATIVE TECHNOLOGY', 'MASTER OF FASHION DESIGN & TECHNOLOGY',
    ].join('\n'));
    expect(ex).toMatchObject({
      address: 'H-1, R-2/A, Sector-3, Uttara 1230, Dhaka, Bangladesh', phone: '01784000102',
      degree: 'MASTER OF FASHION DESIGN & TECHNOLOGY', specialization: 'FASHION DESIGN & TECHNOLOGY',
      institution: 'SHANTO-MARIAM UNIVERSITY OF CREATIVE TECHNOLOGY',
      lastPosition: 'SR MANAGER | DESIGN & PD', workplace: 'LANTABUR GROUP',
    });
    expect(ex.previousJobs).toBe('SR MANAGER | DESIGN & PD, LANTABUR GROUP (2025 – Present)\nMANAGER | DESIGN & PD, BEXIMCO (2017 – 2024)');
  });

  it('reads labelled job blocks and a degree written before its education heading', () => {
    const ex = extractFromText([
      'House # Capital Park (2nd Floor)\tMobile no # 01712 000111', 'Flat no. C2, Muktizoddha Road,\tHome cell # 01796 000222', 'Azompur, Uttara, Dhaka\tE-mail # hasan@example.com',
      'MD. HASAN MAHMUD',
      'Total Experience: 20 years running (2006 to till date)',
      'Experience\tPRESENT JOB STATUS :', 'Job Position : AGM (HR, Admin & Compliance)', 'Duration : February 18, 2023 to Continuing.',
      'Company Name : EDISON GROUP (Garments Manufacturer)', 'Professional Experience: II', 'Duration : January 01, 2011 to December 09, 2013.',
      'Job Position : Assistant Manager (HR & Compliance)', 'Company Name : Shore to Shore Bangladesh Ltd.',
      'MBA (Human Resource Management)', 'Education Session : 2009 - 2010\tUniversity of South Asia, Bangladesh', 'Passing year : 2010', 'CGPA – 3.50 (-A)',
      'B.Sc. Honors in Geology & Mining', 'Session 1998-1999\tUniversity of Rajshahi',
      'Date of Birth\tNovember 20, 1980.',
    ].join('\n'), { nameHint: 'MD. HASAN MAHMUD', today: TODAY });
    expect(ex).toMatchObject({
      name: 'MD. HASAN MAHMUD', phone: '01712000111', email: 'hasan@example.com',
      address: 'House # Capital Park (2nd Floor) Flat no. C2, Muktizoddha Road, Azompur, Uttara, Dhaka',
      totalExperienceYears: 20, lastPosition: 'AGM (HR, Admin & Compliance)', workplace: 'EDISON GROUP (Garments Manufacturer)',
      degree: 'MBA (Human Resource Management)', specialization: 'Human Resource Management', institution: 'University of South Asia, Bangladesh',
      cgpa: 3.5, age: 45,
    });
    expect(ex.previousJobs).toBe('AGM (HR, Admin & Compliance), EDISON GROUP (Garments Manufacturer) (February 18, 2023 – Continuing)\nAssistant Manager (HR & Compliance), Shore to Shore Bangladesh Ltd. (2009 – 2010)');
  });

  it('counts a running bachelor when nothing higher is finished', () => {
    const ex = extractFromText([
      'NADIM ISLAM', 'Contact : 01609000111 | Email : nadim@example.com |', 'Adress : Mirpur, Dhaka-1216',
      'EDUCATION', 'Bachelor of Science in Textile Engineering', 'Jhenaidah Textile Engineering College, Jhenaidah\tSession: 2021-2022',
      'Affiliated by Bangladesh University of Textiles\tLevel 4 - Term 2', 'CGPA: 3.47/4.00 (Current)', 'Higher Secondary Certificate', 'Year: 2020', 'Adamjee Cantonment College,Dhaka',
      'INDUSTRIAL EXPERIENCE', 'Fakhruddin Textile Mills ( Urmi Group | Internship Trainee )\tSeptember-November 2026', 'Gained hands-on exposure to knitting.',
    ].join('\n'));
    expect(ex).toMatchObject({
      address: 'Mirpur, Dhaka-1216', degree: 'Bachelor of Science in Textile Engineering', specialization: 'Textile Engineering',
      institution: 'Jhenaidah Textile Engineering College, Jhenaidah', cgpa: 3.47,
      lastPosition: 'Internship Trainee', workplace: 'Fakhruddin Textile Mills (Urmi Group)',
    });
  });
});

describe('PDF layout', () => {
  const item = (str: string, x: number, y: number, h = 10, w = str.length * h * 0.5): PdfItem => ({ str, x, y, w, h });

  it('reads a sidebar column before the main column instead of mixing their lines', () => {
    const left = ['CONTACT', '01711000111', 'a@example.com', 'SKILLS', 'Microsoft Excel and Power BI', 'Outlook', 'Teamwork', 'Planning'].map((s, i) => item(s, 40, 700 - i * 18, 9, s.length * 5.5));
    const right = ['EXPERIENCE', 'Officer, Alpha Ltd', 'Duties described here', 'EDUCATION', 'BBA in Marketing', 'Dhaka University', 'CGPA 3.50 / 4.00'].map((s, i) => item(s, 260, 705 - i * 13, 9, 280));
    const lay = layoutPdf([{ width: 595, height: 842, items: [item('JANE DOE', 260, 790, 30), ...left, ...right] }]);
    const lines = lay.text.split('\n');
    expect(lines.indexOf('Planning')).toBeLessThan(lines.indexOf('EXPERIENCE'));
    expect(lines.slice(lines.indexOf('EDUCATION'), lines.indexOf('EDUCATION') + 3)).toEqual(['EDUCATION', 'BBA in Marketing', 'Dhaka University']);
    expect(lay.nameHint).toBe('JANE DOE');
  });

  it('rebuilds a table whose cells wrap over several lines into one row per entry', () => {
    const items = [
      item('Academic Qualification:', 57, 500, 12),
      item('Exam Title', 117, 463, 11, 51), item('Concentration/', 186, 463, 11, 75), item('Major', 209, 450, 11, 29),
      item('Institute', 287, 463, 11, 41), item('Result', 358, 463, 11, 30), item('Pass.Year', 396, 463, 11, 45), item('Duration', 446, 463, 11, 44),
      // row 1: the institute and the result wrap
      item('Bachelor of Arts', 112, 435, 9, 63), item('(BA)', 135, 424, 9, 16), item('History', 208, 435, 9, 29),
      item('Modhupur Adorsho', 269, 435, 9, 79), item('College', 291, 424, 9, 34),
      item('Second', 358, 435, 9, 29), item('Class', 363, 424, 9, 20), item('Marks:', 360, 413, 9, 26), item('52%', 361, 402, 9, 24),
      item('2016', 408, 435, 9, 19), item('3', 465, 435, 9, 5),
      // row 2
      item('HSC', 130, 387, 9, 20), item('Science', 206, 387, 9, 34), item('Govt. College', 277, 387, 9, 62),
      item('CGPA :', 358, 387, 9, 29), item('4.10 (out of 5)', 352, 376, 9, 40), item('2012', 408, 387, 9, 19), item('2', 465, 387, 9, 5),
      item('Training Summary:', 57, 340, 12),
    ];
    const lay = layoutPdf([{ width: 595, height: 842, items }]);
    expect(lay.text.split('\n')).toEqual([
      'Academic Qualification:',
      'Exam Title: Bachelor of Arts (BA) | Concentration/Major: History | Institute: Modhupur Adorsho College | Result: Second Class Marks: 52% | Pass.Year: 2016 | Duration: 3',
      'Exam Title: HSC | Concentration/Major: Science | Institute: Govt. College | Result: CGPA : 4.10 (out of 5) | Pass.Year: 2012 | Duration: 2',
      'Training Summary:',
    ]);
    const ex = extractFromText(lay.text);
    expect(ex).toMatchObject({ degree: 'Bachelor of Arts (BA)', specialization: 'History', institution: 'Modhupur Adorsho College' });
  });

  it('keeps "Exam" / "Title" and "Pass" / "Year" header labels written on two lines as columns of their own (Bdjobs export)', () => {
    const items = [
      item('Academic Qualification:', 10, 818, 13, 172),
      item('Exam', 20, 789, 12, 37), item('Pass', 458, 789, 12, 31),
      item('Concentration/Major', 65, 782, 12, 141), item('Institute', 229, 782, 12, 59), item('Result', 356, 782, 12, 42), item('Duration', 502, 782, 12, 59),
      item('Title', 24, 775, 12, 30), item('Year', 458, 775, 12, 31),
      // row 1
      item('Northfield', 230, 755, 12, 55), item('Second Class, Marks', 315, 755, 12, 124),
      item('M.B.S', 17, 747.5, 12, 35), item('Accounting', 99, 747.5, 12, 66), item('2006', 454, 747.5, 12, 30), item('2', 524, 747.5, 12, 8),
      item('University', 224, 740, 12, 60), item(':45%', 356, 740, 12, 34),
      // row 2
      item('B.', 32, 720, 12, 13), item('Northfield', 230, 720, 12, 55), item('Second Class, Marks', 315, 720, 12, 124),
      item('Pass Course', 100, 713, 12, 73), item('2000', 454, 713, 12, 30), item('2', 524, 713, 12, 8),
      item('Com', 21, 706, 12, 27), item('University', 224, 706, 12, 60), item(':49%', 356, 706, 12, 34),
      item('Professional Qualification:', 10, 640, 13, 172),
    ];
    const lay = layoutPdf([{ width: 595, height: 842, items }]);
    const rows = lay.text.split('\n').filter((l) => l.startsWith('Exam Title:'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Pass Year: 2006');
    const ex = extractFromText(lay.text);
    expect(ex).toMatchObject({ degree: 'M.B.S', specialization: 'Accounting', institution: 'Northfield University' });
    expect(ex.education).toContain('B. Com');
  });
});

// Layouts met in the owner's sample CV folders (2026-11-08), with made-up people.
describe('CV extraction: layouts from the sample CV bank', () => {
  it('reads Word-symbol bullets, an empty education heading beside a certificate column, and companies over "Designation:"', () => {
    const ex = extractFromText([
      'CAREER SUMMARY', 'HR professional with over 8', 'years of experience in Talent Acquisition.',
      'CONTACT', 'Luxmipura, Joydebpur, Gazipur.', '01700-000001', 'rafiq.hasan@example.com',
      'SKILLS:', ' HR Operations', ' Performance Management (KPI/PMS)',
      'Rafiq Hasan',
      'WORK EXPERIENCES', 'ALPHA KNIT INDUSTRIES LTD. (ALPHA GROUP)', 'Designation: Asst. Manager- HRD & OD', 'Duration: 01 Feb 2024 –Till Date',
      ' Lead end-to-end talent acquisition.',
      'BETA APPARELS LTD. (BETA GROUP)', 'Designation: Sr. Executive- HR & Compliance', 'Duration: 01 April 2022 –22 Jan 2024',
      'EDUCATIONAL QUALIFICATION', 'CERTIFICATIONS',
      ' Certified KPI Professional\t PGDHRM under AIUB 2025, CGPA- 3.41',
      ' Payroll Management Master class\t MBA in Management -2018, CGPA- 2.94',
      ' KPI based Performance Appraisal\t BBA in Management -2017, CGPA- 2.91',
    ].join('\n'), { today: TODAY, nameHint: 'Rafiq Hasan' }); // the PDF prints the name biggest
    expect(ex).toMatchObject({ degree: 'MBA in Management', specialization: 'Management', cgpa: 2.94, lastPosition: 'Asst. Manager- HRD & OD', workplace: 'ALPHA KNIT INDUSTRIES LTD. (ALPHA GROUP)' });
    expect(ex.skills).toBe('HR Operations, Performance Management (KPI/PMS)');
    expect(ex.certifications).toBe('Certified KPI Professional; Payroll Management Master class; KPI based Performance Appraisal');
    expect(ex.previousJobs).toContain('Sr. Executive- HR & Compliance, BETA APPARELS LTD. (BETA GROUP)');
  });

  it('reads "Resume of" names, a degree with its year, a Contact: address and education in sentences', () => {
    const ex = extractFromText([
      'Resume of Karim Uddin', 'CONTACT:\tHouse 14, Road 06, Rupnagar R/A, Mirpur,', 'Dhaka.', 'karim.uddin@example.com', '01900000002',
      'Job Experience:',
      'Assistant Manager (HR & Administration), Gamma International Company Limited\tMay’25 to till now',
      '• Lead HR & Administration operations for 275+ employees.',
      'Academic Qualification:',
      '• MBA in Human Resource Management from Delta University with CGPA 2.74 out of 4 in 2019.',
      '• BBA in Marketing from Epsilon International University, Bangladesh, with CGPA 3.43 out of 4 in 2017.',
      'EDUCATION', 'Masters of Laws (LL.M) 2019', 'Zeta University of Professionals', 'CGPA: 2.96',
    ].join('\n'), { nameHint: 'Resume of Karim Uddin' });
    expect(ex).toMatchObject({ name: 'Karim Uddin', address: 'House 14, Road 06, Rupnagar R/A, Mirpur, Dhaka.' });
    expect(ex.education).toContain('MBA in Human Resource Management - Delta University (CGPA 2.74 out of 4, 2019)');
    expect(ex.education).toContain('Masters of Laws (LL.M) - Zeta University of Professionals');
    expect(ex).toMatchObject({ lastPosition: 'Assistant Manager | HR & Administration', workplace: 'Gamma International Company Limited' });
  });

  it('reads labelled education, "Position Held" and a name with a nickname', () => {
    const ex = extractFromText([
      'Resume', 'Of', 'Nasrin Akter (Jyoti)', 'House 10, Tolarbagh, Mirpur-1', 'nasrin@example.com', '+88 - 01777 000003',
      'Experiences:', 'Organization Name : Theta Footwear Ltd', 'Position Held : Deputy Manager (Design & Development)', 'Duration : 17 December 2023 to till date',
      'Educational Background:', 'Masters in Clothing & Textile, 2015', 'Name of the University : Iota Home Economics Collage', 'Subject : Clothing & Textile', 'Result : First Division',
      'B.Sc. Honors in Fashion Design, 2011', 'Name of the University : Kappa Women\'s College', 'Subject : Fashion Design', 'Result : 3.43 on a scale of 4.00',
    ].join('\n'));
    expect(ex).toMatchObject({ name: 'Nasrin Akter', degree: 'Masters in Clothing & Textile', institution: 'Iota Home Economics Collage', lastPosition: 'Deputy Manager (Design & Development)', workplace: 'Theta Footwear Ltd' });
    expect(ex.education).toContain("B.Sc. Honors in Fashion Design - Kappa Women's College (3.43 on a scale of 4.00, 2011)");
  });

  it('does not take "MS Office" for a master\'s, and a degree "In progress" does not replace a finished one', () => {
    const ex = extractFromText([
      'Lamia Sultana', 'ACADEMIC BACKGROUND',
      'Masters of Business Administration (MBA.)', 'Lambda University.', 'Major: Apparel Merchandising & Fashion Management.', 'Passing Year: 2025-2026 Running', 'Result: In progress',
      'Bachelor of Science (B.Sc. Hons.)', 'Mu Institute of Science & Technology', 'Major: Apparel Manufacturing & Technology.', 'Passing Year: 2021', 'Result: CGPA 3.01',
      'SOFTWARE SKILLS', '95%\t95%', 'MS Office', 'Outlook Mail',
    ].join('\n'));
    expect(ex).toMatchObject({ degree: 'Bachelor of Science (B.Sc. Hons.)', specialization: 'Apparel Manufacturing & Technology', cgpa: 3.01, skills: 'MS Office, Outlook Mail' });
  });

  it('reads a title and company written above the dates, and keeps "Key Responsibilities:" inside the job', () => {
    const ex = extractFromText([
      'Selina Haque', 'PROFESSIONAL WORK EXPERIENCE',
      '1. Nu Group (Xi Stitch Design Ltd.)\tSavar, Dhaka', 'Sr. Manager‐Admin, HR & Compliance\tJune 2026 ‐ Present', 'Key Responsibilities:', 'Oversee HR and compliance.',
      '2. Omicron Group\tGazipur', 'Sr. Manager – Admin, HR & Compliance\tMarch 2023‐ May 26', 'Key Achievements:', ' Maintained 100% compliance.',
      'PROFESSIONAL EXPERIENCE', 'Senior Executive – Finance & Accounts | Pi Corporation Pvt. Ltd.', 'July 2023 – Present', ' Manage Accounts Payable',
    ].join('\n'));
    expect(ex).toMatchObject({ lastPosition: 'Sr. Manager‐Admin | HR & Compliance', workplace: 'Nu Group (Xi Stitch Design Ltd.)' });
    expect(ex.previousJobs!.split('\n')).toEqual([
      'Sr. Manager‐Admin | HR & Compliance, Nu Group (Xi Stitch Design Ltd.) (June 2026 – Present)', 'Sr. Manager – Admin | HR & Compliance, Omicron Group (March 2023 – May 26)',
      'Senior Executive – Finance & Accounts, Pi Corporation Pvt. Ltd. (July 2023 – Present)',
    ]);
  });
});

describe('CV extraction: dates, experience, age and contact', () => {
  it('keeps each job\'s dates and adds up the years when the CV states no total (overlaps once, internships not counted)', () => {
    const ex = extractFromText([
      'Tania Rahman', 'tania@example.com', '01711000004', 'WORK EXPERIENCE',
      'Senior Officer | Rho Textiles Ltd.\tJan 2020 – Present',
      'Officer | Sigma Apparels Ltd.\tJan 2018 – Jun 2020',
      'Intern | Tau Bank Ltd.\tJan 2017 – Jun 2017',
    ].join('\n'), { today: TODAY });
    expect(ex.previousJobs!.split('\n')[0]).toBe('Senior Officer, Rho Textiles Ltd. (Jan 2020 – Present)');
    expect(ex.totalExperienceYears).toBe(8.9); // Jan 2018 to Nov 2026 (both months counted), the overlap once
    // A stated total wins over the dates.
    expect(extractFromText(['Tania Rahman', 'Total experience: 5 years', 'WORK EXPERIENCE', 'Officer | Rho Textiles Ltd.\tJan 2010 – Present'].join('\n'), { today: TODAY }).totalExperienceYears).toBe(5);
  });

  it('works out the age from a month-and-year birth date, and reads a foreign mobile number', () => {
    const ex = extractFromText(['Upal Das', 'Dubai – UAE ◇ +971545856049 ◇ upal@example.com', 'Personal Information', 'Date of Birth\t: Aug 1990'].join('\n'), { today: TODAY });
    expect(ex).toMatchObject({ age: 36, phone: '+971545856049' });
  });

  it('reads an address in any district (Patuakhali, Moulvibazar ...)', () => {
    const ex = extractFromText(['CONTACT', '+8801630-000005', 'Town Kalikapur, Patuakhali Sadar,', 'Patuakhali-8600', 'robin@example.com'].join('\n'));
    expect(ex.address).toBe('Town Kalikapur, Patuakhali Sadar, Patuakhali-8600');
  });
});

describe('CV reading', () => {
  it('refuses text whose fonts carry no character map instead of extracting nothing from it', async () => {
    const junk = `JOHN DOE\n${'\u001f\u001e\u001d\u001c\u001b '.repeat(200)}`;
    await expect(readCv(Buffer.from(junk), 'cv.txt')).rejects.toThrow(/cannot be read/);
    await expect(readCv(Buffer.from('JOHN DOE\nBSc in CSE'), 'cv.txt')).resolves.toMatchObject({ text: 'JOHN DOE\nBSc in CSE' });
  });
});

describe('Word .doc CVs (owner, 2026-11-09)', () => {
  const { docKind } = require('../src/common/file-kind');
  const { validateUpload } = require('../src/common/services');
  const upload = (name: string, buffer: Buffer) => ({ originalname: name, size: buffer.length, buffer }) as any;

  it('tells what a .doc really is, and refuses anything else at upload', () => {
    const ole = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504)]);
    expect(docKind(ole)).toBe('ole');
    expect(docKind(Buffer.from('PK\u0003\u0004rest'))).toBe('docx');
    expect(docKind(Buffer.from(String.raw`{\rtf1\ansi hello}`))).toBe('rtf');
    expect(docKind(Buffer.from('<html><body>x</body></html>'))).toBe('html');
    expect(docKind(Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/related'))).toBe('html');
    expect(validateUpload(upload('cv.doc', ole))).toBeNull();
    expect(validateUpload(upload('cv.doc', Buffer.from('MZ\u0090\u0000 a renamed program')))).toMatch(/not a valid Word \.doc/);
  });

  it('reads an RTF saved as .doc', async () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\*\generator Word;}\f0 Karim Hasan\par Email: karim.hasan@example.com\par Mobile: 01811-222333\par EDUCATION\par B.Sc in CSE, University of Dhaka, 2018\par Caf\'e9 \u8211? work}`;
    const t = await readCv(Buffer.from(rtf, 'latin1'), 'karim.doc');
    expect(t.text).toContain('Karim Hasan\nEmail: karim.hasan@example.com');
    expect(t.text).not.toMatch(/Arial|Word;|fonttbl/);
    expect(t.text).toContain('Café – work');
    expect(extractFromText(t.text)).toMatchObject({ name: 'Karim Hasan', email: 'karim.hasan@example.com' });
  });

  it('reads a web page saved as .doc (job-site downloads)', async () => {
    const html = '<html><head><style>p{}</style></head><body><p><b>SADIA AKTER</b></p><p>E-mail: sadia.akter@example.com</p><p>Mobile: 01999-888777</p><table><tr><td>Exam Title</td><td>Institute</td></tr><tr><td>BSc in Computer Science</td><td>BRAC University</td></tr></table></body></html>';
    const t = await readCv(Buffer.from(html), 'sadia.doc');
    expect(t.text).not.toContain('<');
    expect(extractFromText(t.text)).toMatchObject({ email: 'sadia.akter@example.com' });
    expect(extractFromText(t.text).name).toMatch(/sadia akter/i);
  });

  it('takes the name from the closing signature when the top has none ("Self Profile" is a heading)', () => {
    const ex = extractFromText(['Self Profile', 'A hard working person.', 'OBJECTIVE', 'To contribute to a dynamic team.', 'EDUCATION', 'B.Sc in Textile Engineering, BUET, 2004',
      'Email: rafi@example.com', 'Thanking You', 'Rafiq Hossain ( Rafi )'].join('\n'));
    expect(ex.name).toBe('Rafiq Hossain');
  });
});
