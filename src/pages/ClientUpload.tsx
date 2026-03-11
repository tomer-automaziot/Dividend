import { useState, useEffect, useCallback, useRef } from "react";
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
  Spin,
} from "antd";
import {
  UploadOutlined,
  PlusOutlined,
  DeleteOutlined,
  FileZipOutlined,
  FolderOutlined,
  BankOutlined,
  SwapOutlined,
  SaveOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import { supabaseClient } from "../supabaseClient";

const { Title, Paragraph, Text } = Typography;
const { Panel } = Collapse;

interface StoredFile {
  id: string;
  name: string;
  storagePath?: string;
}

interface Company {
  id?: string;
  name: string;
  files: StoredFile[];
}

interface FileRename {
  id?: string;
  originalName: string;
  newName: string;
  source: string; // "general" or company name
  sourceFileId?: string;
}

export const ClientUploadPage = () => {
  const [loading, setLoading] = useState(true);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // General files state
  const [generalFileNames, setGeneralFileNames] = useState<StoredFile[]>([]);
  const [newFileName, setNewFileName] = useState("");

  // Companies state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [newCompanyName, setNewCompanyName] = useState("");

  // File renames state
  const [fileRenames, setFileRenames] = useState<FileRename[]>([]);

  // Zip files state
  const [zipFiles, setZipFiles] = useState<StoredFile[]>([]);

  // Save timer ref for debounced rename saves
  const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Initialize or load session ---
  useEffect(() => {
    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const existingId = params.get("id");

      if (existingId) {
        await loadSession(existingId);
      } else {
        await createSession();
      }
      setLoading(false);
    };
    init();
  }, []);

  const createSession = async () => {
    const { data, error } = await supabaseClient
      .from("client_submissions")
      .insert({ client_name: "client", status: "draft" })
      .select()
      .single();

    if (error) {
      message.error("שגיאה ביצירת הפגישה");
      return;
    }

    setSubmissionId(data.id);
    const newUrl = `${window.location.pathname}?id=${data.id}`;
    window.history.replaceState({}, "", newUrl);
  };

  const loadSession = async (id: string) => {
    try {
      // Load submission
      const { data: sub, error: subErr } = await supabaseClient
        .from("client_submissions")
        .select()
        .eq("id", id)
        .single();

      if (subErr || !sub) {
        message.error("לא נמצאה הגשה עם מזהה זה");
        await createSession();
        return;
      }

      setSubmissionId(id);

      // Load general files
      const { data: gFiles } = await supabaseClient
        .from("general_files")
        .select()
        .eq("submission_id", id);

      if (gFiles) {
        setGeneralFileNames(
          gFiles.map((f) => ({
            id: f.id,
            name: f.file_name,
            storagePath: f.storage_path || undefined,
          }))
        );
      }

      // Load companies and their files
      const { data: comps } = await supabaseClient
        .from("companies")
        .select()
        .eq("submission_id", id);

      if (comps) {
        const loadedCompanies: Company[] = [];
        for (const comp of comps) {
          const { data: cFiles } = await supabaseClient
            .from("company_files")
            .select()
            .eq("company_id", comp.id);

          loadedCompanies.push({
            id: comp.id,
            name: comp.company_name,
            files: (cFiles || []).map((f) => ({
              id: f.id,
              name: f.file_name,
              storagePath: f.storage_path || undefined,
            })),
          });
        }
        setCompanies(loadedCompanies);
      }

      // Load file renames
      const { data: renames } = await supabaseClient
        .from("field_changes")
        .select()
        .eq("submission_id", id);

      if (renames) {
        const loadedRenames: FileRename[] = renames.map((r) => ({
          id: r.id,
          originalName: r.original_field_name,
          newName: r.new_field_name,
          source: r.general_file_id ? "general" : "company",
          sourceFileId: r.general_file_id || r.company_file_id,
        }));
        setFileRenames(loadedRenames);
      }

      // Load zip files
      const { data: zips } = await supabaseClient
        .from("zip_examples")
        .select()
        .eq("submission_id", id);

      if (zips) {
        setZipFiles(
          zips.map((z) => ({
            id: z.id,
            name: z.file_name,
            storagePath: z.storage_path,
          }))
        );
      }
    } catch {
      message.error("שגיאה בטעינת הנתונים");
    }
  };

  // --- General Files ---
  const addGeneralFile = async () => {
    if (!newFileName.trim() || !submissionId) return;
    const name = newFileName.trim();

    const { data, error } = await supabaseClient
      .from("general_files")
      .insert({ submission_id: submissionId, file_name: name })
      .select()
      .single();

    if (error) {
      message.error("שגיאה בהוספת קובץ");
      return;
    }

    setGeneralFileNames([
      ...generalFileNames,
      { id: data.id, name },
    ]);
    setNewFileName("");
  };

  const removeGeneralFile = async (index: number) => {
    const file = generalFileNames[index];
    if (file.id) {
      await supabaseClient.from("general_files").delete().eq("id", file.id);
      // Also remove related renames
      await supabaseClient
        .from("field_changes")
        .delete()
        .eq("general_file_id", file.id);
    }
    setGeneralFileNames(generalFileNames.filter((_, i) => i !== index));
    setFileRenames(fileRenames.filter((r) => r.sourceFileId !== file.id));
  };

  const handleGeneralFileUpload = async (file: File) => {
    if (!submissionId) return false;

    const path = `${submissionId}/general/${file.name}`;
    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from("initial-files-upload")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      message.error(`שגיאה בהעלאת ${file.name}`);
      return false;
    }

    const { data, error } = await supabaseClient
      .from("general_files")
      .insert({
        submission_id: submissionId,
        file_name: file.name,
        storage_path: uploadData.path,
      })
      .select()
      .single();

    if (error) {
      message.error("שגיאה בשמירת הקובץ");
      return false;
    }

    setGeneralFileNames((prev) => [
      ...prev,
      { id: data.id, name: file.name, storagePath: uploadData.path },
    ]);
    message.success(`${file.name} הועלה בהצלחה`);
    return false; // prevent default upload behavior
  };

  // --- Companies ---
  const addCompany = async () => {
    if (!newCompanyName.trim() || !submissionId) return;
    const name = newCompanyName.trim();

    const { data, error } = await supabaseClient
      .from("companies")
      .insert({ submission_id: submissionId, company_name: name })
      .select()
      .single();

    if (error) {
      message.error("שגיאה בהוספת חברה");
      return;
    }

    setCompanies([...companies, { id: data.id, name, files: [] }]);
    setNewCompanyName("");
  };

  const removeCompany = async (index: number) => {
    const company = companies[index];
    if (company.id) {
      // Delete company files from storage
      for (const f of company.files) {
        if (f.storagePath) {
          await supabaseClient.storage
            .from("initial-files-upload")
            .remove([f.storagePath]);
        }
      }
      await supabaseClient.from("companies").delete().eq("id", company.id);
    }
    setCompanies(companies.filter((_, i) => i !== index));
    setFileRenames(
      fileRenames.filter(
        (r) => !company.files.some((f) => f.id === r.sourceFileId)
      )
    );
  };

  const handleCompanyFileUpload = async (companyIndex: number, file: File) => {
    const company = companies[companyIndex];
    if (!submissionId || !company.id) return false;

    const path = `${submissionId}/companies/${company.name}/${file.name}`;
    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from("initial-files-upload")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      message.error(`שגיאה בהעלאת ${file.name}`);
      return false;
    }

    const { data, error } = await supabaseClient
      .from("company_files")
      .insert({
        company_id: company.id,
        submission_id: submissionId,
        file_name: file.name,
        storage_path: uploadData.path,
      })
      .select()
      .single();

    if (error) {
      message.error("שגיאה בשמירת הקובץ");
      return false;
    }

    setCompanies((prev) => {
      const updated = [...prev];
      updated[companyIndex] = {
        ...updated[companyIndex],
        files: [
          ...updated[companyIndex].files,
          { id: data.id, name: file.name, storagePath: uploadData.path },
        ],
      };
      return updated;
    });
    message.success(`${file.name} הועלה בהצלחה`);
    return false;
  };

  const removeCompanyFile = async (companyIndex: number, fileIndex: number) => {
    const file = companies[companyIndex].files[fileIndex];
    if (file.id) {
      await supabaseClient.from("company_files").delete().eq("id", file.id);
      await supabaseClient
        .from("field_changes")
        .delete()
        .eq("company_file_id", file.id);
    }
    if (file.storagePath) {
      await supabaseClient.storage
        .from("initial-files-upload")
        .remove([file.storagePath]);
    }
    setCompanies((prev) => {
      const updated = [...prev];
      updated[companyIndex] = {
        ...updated[companyIndex],
        files: updated[companyIndex].files.filter((_, i) => i !== fileIndex),
      };
      return updated;
    });
    setFileRenames(fileRenames.filter((r) => r.sourceFileId !== file.id));
  };

  // --- File Renames (step 3) ---
  const updateFileRename = useCallback(
    async (sourceFileId: string, newName: string, isGeneral: boolean) => {
      if (!submissionId) return;

      setFileRenames((prev) => {
        const existing = prev.find((r) => r.sourceFileId === sourceFileId);
        if (existing) {
          return prev.map((r) =>
            r.sourceFileId === sourceFileId ? { ...r, newName } : r
          );
        }
        return [
          ...prev,
          {
            originalName: "",
            newName,
            source: isGeneral ? "general" : "company",
            sourceFileId,
          },
        ];
      });

      // Debounce the DB save
      if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
      renameTimerRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          // Check if rename record exists
          const filterCol = isGeneral ? "general_file_id" : "company_file_id";
          const { data: existing } = await supabaseClient
            .from("field_changes")
            .select()
            .eq(filterCol, sourceFileId)
            .eq("submission_id", submissionId);

          // Get original file name
          let originalName = "";
          if (isGeneral) {
            const { data: f } = await supabaseClient
              .from("general_files")
              .select("file_name")
              .eq("id", sourceFileId)
              .single();
            originalName = f?.file_name || "";
          } else {
            const { data: f } = await supabaseClient
              .from("company_files")
              .select("file_name")
              .eq("id", sourceFileId)
              .single();
            originalName = f?.file_name || "";
          }

          if (existing && existing.length > 0) {
            if (newName) {
              await supabaseClient
                .from("field_changes")
                .update({
                  original_field_name: originalName,
                  new_field_name: newName,
                })
                .eq("id", existing[0].id);
            } else {
              await supabaseClient
                .from("field_changes")
                .delete()
                .eq("id", existing[0].id);
            }
          } else if (newName) {
            await supabaseClient.from("field_changes").insert({
              submission_id: submissionId,
              [filterCol]: sourceFileId,
              original_field_name: originalName,
              new_field_name: newName,
            });
          }
        } catch {
          message.error("שגיאה בשמירת שינוי שם");
        }
        setSaving(false);
      }, 800);
    },
    [submissionId]
  );

  // --- Zip files ---
  const handleZipUpload = async (file: File) => {
    if (!submissionId) return false;

    const path = `${submissionId}/zip/${file.name}`;
    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from("initial-files-upload")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      message.error(`שגיאה בהעלאת ${file.name}`);
      return false;
    }

    const { data, error } = await supabaseClient
      .from("zip_examples")
      .insert({
        submission_id: submissionId,
        file_name: file.name,
        storage_path: uploadData.path,
      })
      .select()
      .single();

    if (error) {
      message.error("שגיאה בשמירת קובץ ZIP");
      return false;
    }

    setZipFiles((prev) => [
      ...prev,
      { id: data.id, name: file.name, storagePath: uploadData.path },
    ]);
    message.success(`${file.name} הועלה בהצלחה`);
    return false;
  };

  const removeZipFile = async (index: number) => {
    const file = zipFiles[index];
    if (file.id) {
      await supabaseClient.from("zip_examples").delete().eq("id", file.id);
    }
    if (file.storagePath) {
      await supabaseClient.storage
        .from("initial-files-upload")
        .remove([file.storagePath]);
    }
    setZipFiles(zipFiles.filter((_, i) => i !== index));
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    message.success("הקישור הועתק!");
  };

  // Build rename table data
  const renameTableData: {
    key: string;
    source: string;
    originalName: string;
    newName: string;
    fileId: string;
    isGeneral: boolean;
  }[] = [];

  generalFileNames.forEach((file) => {
    const rename = fileRenames.find((r) => r.sourceFileId === file.id);
    renameTableData.push({
      key: `general-${file.id}`,
      source: "תיקייה כללית",
      originalName: file.name,
      newName: rename?.newName || "",
      fileId: file.id!,
      isGeneral: true,
    });
  });

  companies.forEach((company) => {
    company.files.forEach((file) => {
      const rename = fileRenames.find((r) => r.sourceFileId === file.id);
      renameTableData.push({
        key: `company-${file.id}`,
        source: company.name,
        originalName: file.name,
        newName: rename?.newName || "",
        fileId: file.id!,
        isGeneral: false,
      });
    });
  });

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <Spin size="large" tip="טוען..." />
      </div>
    );
  }

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
          marginBottom: 16,
        }}
      >
        אנא העלה את הקבצים והנתונים שלך כדי שנוכל להגדיר את האוטומציה עבורך.
      </Paragraph>

      {/* Share link */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <Button icon={<LinkOutlined />} onClick={copyLink} type="dashed">
          העתק קישור לדף זה
        </Button>
        {saving && (
          <Tag
            icon={<SaveOutlined spin />}
            color="processing"
            style={{ marginRight: 8 }}
          >
            שומר...
          </Tag>
        )}
        <Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}
        >
          כל שינוי נשמר אוטומטית. שתף את הקישור כדי שאחרים יוכלו לצפות בדף זה.
        </Paragraph>
      </div>

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
              {generalFileNames.map((file, index) => (
                <Tag
                  key={file.id || index}
                  closable
                  onClose={() => removeGeneralFile(index)}
                  color={file.storagePath ? "green" : "blue"}
                  style={{
                    marginBottom: 8,
                    fontSize: 14,
                    padding: "4px 10px",
                  }}
                >
                  {file.storagePath && <UploadOutlined />} {file.name}
                </Tag>
              ))}
            </div>
          )}
        </div>

        <Divider />

        <div>
          <Text strong>העלאת קבצים לדוגמה עבור התיקייה הכללית:</Text>
          <div style={{ marginTop: 8 }}>
            <Upload
              multiple
              beforeUpload={(file) => {
                handleGeneralFileUpload(file);
                return false;
              }}
              showUploadList={false}
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
              key={company.id || companyIndex}
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
                beforeUpload={(file) => {
                  handleCompanyFileUpload(companyIndex, file);
                  return false;
                }}
                showUploadList={false}
              >
                <Button icon={<UploadOutlined />}>לחץ לבחירת קבצים</Button>
              </Upload>

              {company.files.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {company.files.map((file, fileIndex) => (
                    <Tag
                      key={file.id || fileIndex}
                      closable
                      onClose={() => removeCompanyFile(companyIndex, fileIndex)}
                      color="green"
                      style={{
                        marginBottom: 8,
                        fontSize: 14,
                        padding: "4px 10px",
                      }}
                    >
                      <UploadOutlined /> {file.name}
                    </Tag>
                  ))}
                </div>
              )}
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

        {renameTableData.length === 0 ? (
          <Paragraph type="secondary" style={{ textAlign: "center" }}>
            עדיין לא נוספו קבצים. הוסף קבצים בסעיפים 1 ו-2 כדי לראות אותם
            כאן.
          </Paragraph>
        ) : (
          <Table
            dataSource={renameTableData}
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
                  record: (typeof renameTableData)[number]
                ) => (
                  <Input
                    placeholder="הזן שם קובץ חדש"
                    value={text}
                    onChange={(e) =>
                      updateFileRename(
                        record.fileId,
                        e.target.value,
                        record.isGeneral
                      )
                    }
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
          beforeUpload={(file) => {
            handleZipUpload(file);
            return false;
          }}
          showUploadList={false}
          accept=".zip,.rar,.7z"
        >
          <Button icon={<UploadOutlined />} size="large">
            לחץ להעלאת קובץ ZIP
          </Button>
        </Upload>

        {zipFiles.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {zipFiles.map((file, index) => (
              <Tag
                key={file.id || index}
                closable
                onClose={() => removeZipFile(index)}
                color="green"
                style={{
                  marginBottom: 8,
                  fontSize: 14,
                  padding: "4px 10px",
                }}
              >
                <FileZipOutlined /> {file.name}
              </Tag>
            ))}
          </div>
        )}
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
