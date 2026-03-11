import { useState } from "react";
import {
  Typography,
  Card,
  Input,
  Button,
  Upload,
  Space,
  Divider,
  Alert,
  message,
  Tag,
  Collapse,
  Table,
} from "antd";
import {
  UploadOutlined,
  PlusOutlined,
  DeleteOutlined,
  FileZipOutlined,
  FolderOutlined,
  BankOutlined,
  CheckCircleOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd";
import { supabaseClient } from "../supabaseClient";

const { Title, Paragraph, Text } = Typography;
const { Panel } = Collapse;

interface Company {
  name: string;
  files: UploadFile[];
}

export const ClientUploadPage = () => {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // General files state
  const [generalFileNames, setGeneralFileNames] = useState<string[]>([]);
  const [newFileName, setNewFileName] = useState("");
  const [generalFileUploads, setGeneralFileUploads] = useState<UploadFile[]>(
    []
  );

  // File renames state (shared for step 3)
  const [generalFileRenames, setGeneralFileRenames] = useState<
    Record<string, string>
  >({});
  const [companyFileRenames, setCompanyFileRenames] = useState<
    Record<string, Record<string, string>>
  >({}); // companyName -> { originalName -> newName }

  // Companies state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [newCompanyName, setNewCompanyName] = useState("");

  // Zip file state
  const [zipFiles, setZipFiles] = useState<UploadFile[]>([]);

  // --- General Files ---
  const addGeneralFile = () => {
    if (!newFileName.trim()) return;
    setGeneralFileNames([...generalFileNames, newFileName.trim()]);
    setNewFileName("");
  };

  const removeGeneralFile = (index: number) => {
    const name = generalFileNames[index];
    setGeneralFileNames(generalFileNames.filter((_, i) => i !== index));
    const updated = { ...generalFileRenames };
    delete updated[name];
    setGeneralFileRenames(updated);
  };

  // --- Companies ---
  const addCompany = () => {
    if (!newCompanyName.trim()) return;
    setCompanies([
      ...companies,
      { name: newCompanyName.trim(), files: [] },
    ]);
    setNewCompanyName("");
  };

  const removeCompany = (index: number) => {
    const name = companies[index].name;
    setCompanies(companies.filter((_, i) => i !== index));
    const updated = { ...companyFileRenames };
    delete updated[name];
    setCompanyFileRenames(updated);
  };

  const updateCompanyFiles = (companyIndex: number, files: UploadFile[]) => {
    const updated = [...companies];
    updated[companyIndex].files = files;
    setCompanies(updated);
  };

  // --- Rename handlers for step 3 ---
  const updateGeneralFileRename = (originalName: string, newName: string) => {
    setGeneralFileRenames({ ...generalFileRenames, [originalName]: newName });
  };

  const updateCompanyFileRename = (
    companyName: string,
    originalName: string,
    newName: string
  ) => {
    setCompanyFileRenames({
      ...companyFileRenames,
      [companyName]: {
        ...(companyFileRenames[companyName] || {}),
        [originalName]: newName,
      },
    });
  };

  // --- Upload to Supabase Storage ---
  const uploadFileToStorage = async (
    file: File,
    path: string
  ): Promise<string> => {
    const { data, error } = await supabaseClient.storage
      .from("initial-files-upload")
      .upload(path, file, { upsert: true });

    if (error) throw error;
    return data.path;
  };

  // --- Submit ---
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // 1. Create submission
      const { data: submission, error: subError } = await supabaseClient
        .from("client_submissions")
        .insert({
          client_name: "client",
          status: "submitted",
        })
        .select()
        .single();

      if (subError) throw subError;
      const submissionId = submission.id;

      // 2. Save general file names
      for (const fileName of generalFileNames) {
        const { data: gfRecord, error: gfError } = await supabaseClient
          .from("general_files")
          .insert({
            submission_id: submissionId,
            file_name: fileName,
          })
          .select()
          .single();

        if (gfError) throw gfError;

        // Save the file rename if specified
        const newName = generalFileRenames[fileName];
        if (gfRecord && newName) {
          await supabaseClient.from("field_changes").insert({
            submission_id: submissionId,
            general_file_id: gfRecord.id,
            original_field_name: fileName,
            new_field_name: newName,
          });
        }
      }

      // Upload general file examples
      for (const file of generalFileUploads) {
        if (file.originFileObj) {
          const path = `${submissionId}/general/${file.name}`;
          const storagePath = await uploadFileToStorage(
            file.originFileObj,
            path
          );
          await supabaseClient.from("general_files").insert({
            submission_id: submissionId,
            file_name: file.name,
            storage_path: storagePath,
          });
        }
      }

      // 3. Companies and their files
      for (const company of companies) {
        const { data: companyRecord, error: compError } = await supabaseClient
          .from("companies")
          .insert({
            submission_id: submissionId,
            company_name: company.name,
          })
          .select()
          .single();

        if (compError) throw compError;

        // Upload company files
        for (const file of company.files) {
          if (file.originFileObj) {
            const path = `${submissionId}/companies/${company.name}/${file.name}`;
            const storagePath = await uploadFileToStorage(
              file.originFileObj,
              path
            );

            const { data: cfRecord } = await supabaseClient
              .from("company_files")
              .insert({
                company_id: companyRecord.id,
                submission_id: submissionId,
                file_name: file.name,
                storage_path: storagePath,
              })
              .select()
              .single();

            // Save file rename if specified
            const renames = companyFileRenames[company.name] || {};
            const newName = renames[file.name];
            if (cfRecord && newName) {
              await supabaseClient.from("field_changes").insert({
                submission_id: submissionId,
                company_file_id: cfRecord.id,
                original_field_name: file.name,
                new_field_name: newName,
              });
            }
          }
        }
      }

      // 4. Zip file
      for (const file of zipFiles) {
        if (file.originFileObj) {
          const path = `${submissionId}/zip/${file.name}`;
          const storagePath = await uploadFileToStorage(
            file.originFileObj,
            path
          );
          await supabaseClient.from("zip_examples").insert({
            submission_id: submissionId,
            file_name: file.name,
            storage_path: storagePath,
          });
        }
      }

      setSubmitted(true);
      message.success("הנתונים נשלחו בהצלחה!");
    } catch (error: unknown) {
      console.error("Submission error:", error);
      const errMsg =
        error instanceof Error ? error.message : "שגיאה לא ידועה";
      message.error(`השליחה נכשלה: ${errMsg}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 24px" }}>
        <Card>
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <CheckCircleOutlined
              style={{ fontSize: 64, color: "#52c41a", marginBottom: 24 }}
            />
            <Title level={2}>תודה רבה!</Title>
            <Paragraph style={{ fontSize: 16 }}>
              הנתונים שלך נשלחו בהצלחה. הצוות שלנו יבדוק את הקבצים ויחזור אליך
              בהקדם.
            </Paragraph>
            <Button type="primary" onClick={() => window.location.reload()}>
              שליחה נוספת
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Build file rename summary data for section 3
  const allFileRenames: {
    key: string;
    source: string;
    originalName: string;
    newName: string;
    onNewNameChange: (val: string) => void;
  }[] = [];

  generalFileNames.forEach((name, idx) => {
    allFileRenames.push({
      key: `general-listed-${idx}`,
      source: "תיקייה כללית",
      originalName: name,
      newName: generalFileRenames[name] || "",
      onNewNameChange: (val) => updateGeneralFileRename(name, val),
    });
  });

  generalFileUploads.forEach((file) => {
    // Avoid duplicates if already listed manually
    if (!generalFileNames.includes(file.name)) {
      allFileRenames.push({
        key: `general-uploaded-${file.uid}`,
        source: "תיקייה כללית",
        originalName: file.name,
        newName: generalFileRenames[file.name] || "",
        onNewNameChange: (val) => updateGeneralFileRename(file.name, val),
      });
    }
  });

  companies.forEach((company) => {
    company.files.forEach((file) => {
      const renames = companyFileRenames[company.name] || {};
      allFileRenames.push({
        key: `company-${company.name}-${file.uid}`,
        source: company.name,
        originalName: file.name,
        newName: renames[file.name] || "",
        onNewNameChange: (val) =>
          updateCompanyFileRename(company.name, file.name, val),
      });
    });
  });

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: "0 24px" }}>
      <Title level={1} style={{ textAlign: "center", marginBottom: 8 }}>
        Dividend - העלאת קבצים
      </Title>
      <Paragraph
        style={{
          textAlign: "center",
          fontSize: 16,
          color: "#666",
          marginBottom: 40,
        }}
      >
        אנא העלה את הקבצים והנתונים שלך כדי שנוכל להגדיר את האוטומציה עבורך.
      </Paragraph>

      {/* הוראות */}
      <Alert
        message="הוראות"
        description={
          <div>
            <Paragraph style={{ marginBottom: 8 }}>
              אנא מלא את כל הסעיפים הבאים כדי לעזור לנו להגדיר את האוטומציה:
            </Paragraph>
            <ol style={{ paddingRight: 20, paddingLeft: 0, marginBottom: 0 }}>
              <li>
                <strong>קבצי תיקייה כללית</strong> - רשום את כל שמות הקבצים
                שיועלו לתיקייה הכללית, ולאחר מכן העלה דוגמאות של כל קובץ.
              </li>
              <li>
                <strong>תיקיות חברות</strong> - הוסף כל חברת ביטוח שאיתה אתה
                עובד. עבור כל חברה, העלה קבצים לדוגמה השייכים לתיקייה של אותה
                חברה.
              </li>
              <li>
                <strong>שינויי שמות קבצים</strong> - עבור כל קובץ (כללי או לפי
                חברה), ציין את שם הקובץ החדש שנדרש לשנות.
              </li>
              <li>
                <strong>קובץ ZIP לדוגמה</strong> - העלה דוגמה לקובץ ZIP שאתה
                מקבל בדרך כלל במייל.
              </li>
            </ol>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 32 }}
      />

      {/* סעיף 1: קבצי תיקייה כללית */}
      <Card
        title={
          <span>
            <FolderOutlined /> סעיף 1: קבצי תיקייה כללית
          </span>
        }
        style={{ marginBottom: 24 }}
      >
        <Alert
          message="רשום את כל שמות הקבצים שיוכנסו לתיקייה הכללית, ולאחר מכן העלה דוגמאות של קבצים אלו."
          type="info"
          style={{ marginBottom: 16 }}
        />

        {/* רשימת שמות קבצים */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>שמות קבצים:</Text>
          <div style={{ marginTop: 8 }}>
            <Space.Compact style={{ width: "100%" }}>
              <Input
                placeholder="הזן שם קובץ (לדוגמה: report.xlsx)"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onPressEnter={addGeneralFile}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={addGeneralFile}
              >
                הוסף
              </Button>
            </Space.Compact>
          </div>

          {generalFileNames.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {generalFileNames.map((name, index) => (
                <Tag
                  key={index}
                  closable
                  onClose={() => removeGeneralFile(index)}
                  color="blue"
                  style={{ marginBottom: 8, fontSize: 14, padding: "4px 10px" }}
                >
                  {name}
                </Tag>
              ))}
            </div>
          )}
        </div>

        <Divider />

        {/* העלאת קבצים כלליים */}
        <div>
          <Text strong>העלאת קבצים לדוגמה עבור התיקייה הכללית:</Text>
          <div style={{ marginTop: 8 }}>
            <Upload
              multiple
              beforeUpload={() => false}
              fileList={generalFileUploads}
              onChange={({ fileList }) => setGeneralFileUploads(fileList)}
            >
              <Button icon={<UploadOutlined />}>לחץ לבחירת קבצים</Button>
            </Upload>
          </div>
        </div>
      </Card>

      {/* סעיף 2: תיקיות חברות ביטוח */}
      <Card
        title={
          <span>
            <BankOutlined /> סעיף 2: תיקיות חברות ביטוח
          </span>
        }
        style={{ marginBottom: 24 }}
      >
        <Alert
          message="הוסף כל חברת ביטוח שאיתה אתה עובד. עבור כל חברה, העלה קבצים לדוגמה השייכים לתיקייה של אותה חברה."
          type="info"
          style={{ marginBottom: 16 }}
        />

        <div style={{ marginBottom: 16 }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="הזן שם חברת ביטוח"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              onPressEnter={addCompany}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={addCompany}
            >
              הוסף חברה
            </Button>
          </Space.Compact>
        </div>

        {companies.length === 0 && (
          <Paragraph type="secondary" style={{ textAlign: "center" }}>
            עדיין לא נוספו חברות ביטוח. הוסף חברה למעלה כדי להתחיל.
          </Paragraph>
        )}

        <Collapse accordion>
          {companies.map((company, companyIndex) => (
            <Panel
              key={companyIndex}
              header={
                <Space>
                  <BankOutlined />
                  <Text strong>{company.name}</Text>
                  <Tag>{company.files.length} קבצים</Tag>
                </Space>
              }
              extra={
                <DeleteOutlined
                  style={{ color: "#ff4d4f" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCompany(companyIndex);
                  }}
                />
              }
            >
              <Text strong style={{ display: "block", marginBottom: 8 }}>
                העלאת קבצים לדוגמה עבור "{company.name}":
              </Text>
              <Upload
                multiple
                beforeUpload={() => false}
                fileList={company.files}
                onChange={({ fileList }) =>
                  updateCompanyFiles(companyIndex, fileList)
                }
              >
                <Button icon={<UploadOutlined />}>לחץ לבחירת קבצים</Button>
              </Upload>
            </Panel>
          ))}
        </Collapse>
      </Card>

      {/* סעיף 3: שינויי שמות קבצים */}
      <Card
        title={
          <span>
            <SwapOutlined /> סעיף 3: שינויי שמות קבצים
          </span>
        }
        style={{ marginBottom: 24 }}
      >
        <Alert
          message="עבור כל קובץ (כללי או לפי חברה), ציין את שם הקובץ החדש שנדרש לשנות. הקבצים מסעיפים 1 ו-2 מוצגים כאן אוטומטית."
          type="info"
          style={{ marginBottom: 16 }}
        />

        {allFileRenames.length === 0 ? (
          <Paragraph type="secondary" style={{ textAlign: "center" }}>
            עדיין לא נוספו קבצים. הוסף קבצים בסעיפים 1 ו-2 כדי לראות אותם
            כאן.
          </Paragraph>
        ) : (
          <Table
            dataSource={allFileRenames}
            pagination={false}
            size="middle"
            columns={[
              {
                title: "מקור",
                dataIndex: "source",
                width: 150,
                render: (text: string) => <Tag color="blue">{text}</Tag>,
              },
              {
                title: "שם קובץ מקורי",
                dataIndex: "originalName",
                render: (text: string) => <Text>{text}</Text>,
              },
              {
                title: "",
                width: 30,
                render: () => <span>←</span>,
              },
              {
                title: "שם קובץ חדש",
                dataIndex: "newName",
                render: (
                  text: string,
                  record: (typeof allFileRenames)[number]
                ) => (
                  <Input
                    placeholder="הזן שם קובץ חדש"
                    value={text}
                    onChange={(e) => record.onNewNameChange(e.target.value)}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>

      {/* סעיף 4: קובץ ZIP לדוגמה */}
      <Card
        title={
          <span>
            <FileZipOutlined /> סעיף 4: קובץ ZIP לדוגמה
          </span>
        }
        style={{ marginBottom: 24 }}
      >
        <Alert
          message="העלה דוגמה לקובץ ZIP שאתה מקבל בדרך כלל במייל. זה יעזור לנו להבין את מבנה הקבצים שנעבד."
          type="info"
          style={{ marginBottom: 16 }}
        />

        <Upload
          beforeUpload={() => false}
          fileList={zipFiles}
          onChange={({ fileList }) => setZipFiles(fileList)}
          accept=".zip,.rar,.7z"
        >
          <Button icon={<UploadOutlined />} size="large">
            לחץ להעלאת קובץ ZIP
          </Button>
        </Upload>
      </Card>

      {/* שליחה */}
      <Card>
        <div style={{ textAlign: "center" }}>
          <Paragraph type="secondary">
            אנא בדוק את כל הסעיפים למעלה לפני השליחה. ודא שרשמת את כל שמות
            הקבצים, העלית קבצים לדוגמה, וציינת שמות קבצים חדשים.
          </Paragraph>
          <Button
            type="primary"
            size="large"
            onClick={handleSubmit}
            loading={submitting}
            style={{ minWidth: 200, height: 48, fontSize: 16 }}
          >
            שלח את כל הנתונים
          </Button>
        </div>
      </Card>

      <div
        style={{
          textAlign: "center",
          padding: "24px 0",
          color: "#999",
          fontSize: 12,
        }}
      >
        מופעל על ידי Automaziot
      </div>
    </div>
  );
};
