import { useState } from "react";
import { Refine } from "@refinedev/core";
import { RefineThemes, useNotificationProvider } from "@refinedev/antd";
import { dataProvider } from "@refinedev/supabase";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConfigProvider, App as AntdApp, Form, Input, Button, Card, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import heIL from "antd/locale/he_IL";
import { supabaseClient } from "./supabaseClient";
import { ClientUploadPage } from "./pages/ClientUpload";

import "@refinedev/antd/dist/reset.css";

const CREDENTIALS = { username: "Dividend", password: "Dividend12323!" };

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);

  const onFinish = (values: { username: string; password: string }) => {
    setLoading(true);
    setTimeout(() => {
      if (
        values.username === CREDENTIALS.username &&
        values.password === CREDENTIALS.password
      ) {
        sessionStorage.setItem("authenticated", "true");
        onLogin();
      } else {
        message.error("שם משתמש או סיסמה שגויים");
      }
      setLoading(false);
    }, 300);
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#f0f2f5",
      }}
    >
      <Card title="התחברות" style={{ width: 360 }}>
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item
            name="username"
            label="שם משתמש"
            rules={[{ required: true, message: "נא להזין שם משתמש" }]}
          >
            <Input prefix={<UserOutlined />} placeholder="שם משתמש" />
          </Form.Item>
          <Form.Item
            name="password"
            label="סיסמה"
            rules={[{ required: true, message: "נא להזין סיסמה" }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="סיסמה" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              התחבר
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem("authenticated") === "true"
  );

  if (!authenticated) {
    return (
      <ConfigProvider theme={RefineThemes.Blue} direction="rtl" locale={heIL}>
        <AntdApp>
          <LoginPage onLogin={() => setAuthenticated(true)} />
        </AntdApp>
      </ConfigProvider>
    );
  }

  return (
    <BrowserRouter>
      <ConfigProvider theme={RefineThemes.Blue} direction="rtl" locale={heIL}>
        <AntdApp>
          <Refine
            dataProvider={dataProvider(supabaseClient)}
            notificationProvider={useNotificationProvider}
            resources={[
              {
                name: "client-upload",
                list: "/",
              },
            ]}
          >
            <Routes>
              <Route path="/" element={<ClientUploadPage />} />
            </Routes>
          </Refine>
        </AntdApp>
      </ConfigProvider>
    </BrowserRouter>
  );
}

export default App;
