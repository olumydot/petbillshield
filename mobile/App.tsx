import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

const TOKEN_KEY = "petbill_mobile_session_token";
const API_BASE = (
  process.env.EXPO_PUBLIC_API_URL || "https://api.petbillshield.com/api"
).replace(/\/$/, "");
const BACKEND_ORIGIN = API_BASE.replace(/\/api$/, "");

type User = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
};

type Pet = {
  pet_id: string;
  name: string;
  species?: string;
  breed?: string;
  age_years?: number | null;
  weight_lbs?: number | null;
  is_active?: boolean;
  picture?: string;
  chronic_conditions?: string[];
};

type PetRecord = {
  record_id: string;
  title: string;
  details?: string;
  record_type?: string;
  date?: string;
  amount_usd?: number | null;
};

type Reminder = {
  reminder_id: string;
  title: string;
  message?: string;
  pet_name?: string;
  scheduled_for: string;
  status?: string;
  repeat?: string;
};

type EstimateResult = {
  analysis_id: string;
  summary?: string;
  pet_name?: string;
  estimated_total_usd?: number | null;
  line_items?: Array<{ item?: string; name?: string; cost_usd?: number; urgency?: string }>;
  questions_to_ask_vet?: string[];
};

type TabKey = "overview" | "pets" | "analyze" | "reminders" | "settings";

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "pets", label: "Pets" },
  { key: "analyze", label: "Analyze" },
  { key: "reminders", label: "Reminders" },
  { key: "settings", label: "Settings" },
];

function resolveAssetUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${BACKEND_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

async function request<T>(
  path: string,
  token?: string | null,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!isForm && options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.detail || data?.message || `Request failed (${response.status})`);
  }

  return data as T;
}

export default function App() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 760;

  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [pets, setPets] = useState<Pet[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [selectedPetId, setSelectedPetId] = useState("");
  const [records, setRecords] = useState<PetRecord[]>([]);

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.pet_id === selectedPetId) || pets[0],
    [pets, selectedPetId]
  );

  const hydrate = useCallback(
    async (nextToken: string) => {
      const [me, petRows, reminderRows] = await Promise.all([
        request<User>("/auth/me", nextToken),
        request<Pet[]>("/pets", nextToken),
        request<Reminder[]>("/reminders", nextToken),
      ]);
      setUser(me);
      setPets(petRows);
      setReminders(reminderRows);
      if (!selectedPetId && petRows[0]) setSelectedPetId(petRows[0].pet_id);
    },
    [selectedPetId]
  );

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!alive) return;
        if (saved) {
          setToken(saved);
          await hydrate(saved);
        }
      } catch (error) {
        if (alive) setNotice(parseError(error));
      } finally {
        if (alive) setLoadingSession(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [hydrate]);

  useEffect(() => {
    if (!token || !selectedPet) {
      setRecords([]);
      return;
    }
    let alive = true;
    request<PetRecord[]>(`/pets/${selectedPet.pet_id}/records`, token)
      .then((rows) => alive && setRecords(rows))
      .catch(() => alive && setRecords([]));
    return () => {
      alive = false;
    };
  }, [selectedPet, token]);

  async function signOut() {
    if (token) {
      request<{ ok: boolean }>("/auth/logout", token, { method: "POST" }).catch(() => {});
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setPets([]);
    setReminders([]);
    setRecords([]);
    setTab("overview");
  }

  async function refresh() {
    if (!token) return;
    setBusy(true);
    setNotice("");
    try {
      await hydrate(token);
    } catch (error) {
      setNotice(parseError(error));
    } finally {
      setBusy(false);
    }
  }

  if (loadingSession) {
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar style="light" />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Opening PetBill Shield...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!user || !token) {
    return (
      <AuthScreen
        busy={busy}
        notice={notice}
        onSubmit={async (mode, payload) => {
          setBusy(true);
          setNotice("");
          try {
            const endpoint = mode === "signup" ? "/auth/signup" : "/auth/login";
            const data = await request<{ user: User; session_token: string }>(endpoint, null, {
              method: "POST",
              body: JSON.stringify(payload),
            });
            await SecureStore.setItemAsync(TOKEN_KEY, data.session_token);
            setToken(data.session_token);
            setUser(data.user);
            await hydrate(data.session_token);
          } catch (error) {
            setNotice(parseError(error));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>PB</Text>
          </View>
          <View>
            <Text style={styles.brandTitle}>PetBill Shield</Text>
            <Text style={styles.brandSub}>Mobile companion</Text>
          </View>
        </View>
        <ProfilePill user={user} onPress={() => setTab("settings")} />
      </View>

      <View style={[styles.shell, isTablet && styles.shellTablet]}>
        <ScrollView
          horizontal={!isTablet}
          showsHorizontalScrollIndicator={false}
          style={[styles.nav, isTablet && styles.navTablet]}
          contentContainerStyle={[styles.navContent, isTablet && styles.navContentTablet]}
        >
          {tabs.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={[styles.navItem, tab === item.key && styles.navItemActive]}
            >
              <Text style={[styles.navText, tab === item.key && styles.navTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {notice ? <InlineNotice tone="error" text={notice} /> : null}
          {tab === "overview" ? (
            <OverviewScreen
              user={user}
              pets={pets}
              reminders={reminders}
              records={records}
              selectedPet={selectedPet}
              busy={busy}
              onRefresh={refresh}
              onOpenAnalyze={() => setTab("analyze")}
              onOpenPets={() => setTab("pets")}
            />
          ) : null}
          {tab === "pets" ? (
            <PetsScreen
              token={token}
              pets={pets}
              selectedPet={selectedPet}
              records={records}
              onSelect={(petId) => setSelectedPetId(petId)}
              onCreated={async () => {
                await refresh();
                setNotice("Pet profile added.");
              }}
              onError={(message) => setNotice(message)}
            />
          ) : null}
          {tab === "analyze" ? (
            <AnalyzeScreen
              token={token}
              pets={pets}
              selectedPet={selectedPet}
              onSelectPet={(petId) => setSelectedPetId(petId)}
            />
          ) : null}
          {tab === "reminders" ? <RemindersScreen reminders={reminders} /> : null}
          {tab === "settings" ? (
            <SettingsScreen apiBase={API_BASE} user={user} onSignOut={signOut} />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function AuthScreen({
  busy,
  notice,
  onSubmit,
}: {
  busy: boolean;
  notice: string;
  onSubmit: (
    mode: "login" | "signup",
    payload: Record<string, string>
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.authWrap}
      >
        <ScrollView contentContainerStyle={styles.authContent}>
          <View style={styles.authHero}>
            <Text style={styles.kicker}>AI-powered vet bill clarity</Text>
            <Text style={styles.heroTitle}>
              Your pet care, finally in plain English.
            </Text>
            <Text style={styles.heroText}>
              Sign in to review bills, keep records, track reminders, and carry your
              pet's care context with you.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.segment}>
              <Pressable
                onPress={() => setMode("login")}
                style={[styles.segmentButton, mode === "login" && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === "login" && styles.segmentTextActive]}>
                  Sign in
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMode("signup")}
                style={[styles.segmentButton, mode === "signup" && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === "signup" && styles.segmentTextActive]}>
                  Sign up
                </Text>
              </Pressable>
            </View>

            {mode === "signup" ? (
              <View style={styles.inputRow}>
                <Field
                  label="First name"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
                <Field
                  label="Last name"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>
            ) : null}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {notice ? <InlineNotice tone="error" text={notice} /> : null}
            <Pressable
              disabled={busy}
              style={[styles.primaryButton, busy && styles.disabledButton]}
              onPress={() =>
                onSubmit(
                  mode,
                  mode === "signup"
                    ? { first_name: firstName, last_name: lastName, email, password }
                    : { email, password }
                )
              }
            >
              {busy ? (
                <ActivityIndicator color={colors.paper} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {mode === "signup" ? "Create account" : "Sign in"}
                </Text>
              )}
            </Pressable>
            <Text style={styles.helpText}>
              Google sign-in for mobile needs native OAuth credentials. Email sign-in
              is ready for this first app build.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function OverviewScreen({
  user,
  pets,
  reminders,
  records,
  selectedPet,
  busy,
  onRefresh,
  onOpenAnalyze,
  onOpenPets,
}: {
  user: User;
  pets: Pet[];
  reminders: Reminder[];
  records: PetRecord[];
  selectedPet?: Pet;
  busy: boolean;
  onRefresh: () => void;
  onOpenAnalyze: () => void;
  onOpenPets: () => void;
}) {
  const dueSoon = reminders.filter((item) => item.status !== "sent").slice(0, 3);
  return (
    <View>
      <View style={styles.heroPanel}>
        <Text style={styles.kicker}>Command center</Text>
        <Text style={styles.screenTitle}>Hi {user.name?.split(" ")[0] || "there"}.</Text>
        <Text style={styles.screenText}>
          Review care context, upcoming reminders, and the next bill analysis from one
          pocket-friendly place.
        </Text>
        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={onOpenAnalyze}>
            <Text style={styles.primaryButtonText}>Analyze a bill</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onRefresh}>
            <Text style={styles.secondaryButtonText}>{busy ? "Refreshing" : "Refresh"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.metricGrid}>
        <Metric label="Pets" value={String(pets.length)} />
        <Metric label="Reminders" value={String(reminders.length)} />
        <Metric label="Records" value={String(records.length)} />
      </View>

      <SectionTitle title="Active pet" action="Manage" onPress={onOpenPets} />
      {selectedPet ? <PetCard pet={selectedPet} selected /> : <EmptyState text="Add your first pet on the Pets tab." />}

      <SectionTitle title="Next reminders" />
      {dueSoon.length ? (
        dueSoon.map((item) => <ReminderCard key={item.reminder_id} reminder={item} />)
      ) : (
        <EmptyState text="No upcoming reminders yet." />
      )}
    </View>
  );
}

function PetsScreen({
  token,
  pets,
  selectedPet,
  records,
  onSelect,
  onCreated,
  onError,
}: {
  token: string;
  pets: Pet[];
  selectedPet?: Pet;
  records: PetRecord[];
  onSelect: (petId: string) => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("dog");
  const [saving, setSaving] = useState(false);

  return (
    <View>
      <Text style={styles.screenTitle}>Pets and records</Text>
      <Text style={styles.screenText}>
        Choose a pet to inspect records, or add a quick profile from mobile.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.petRail}>
        {pets.map((pet) => (
          <Pressable key={pet.pet_id} onPress={() => onSelect(pet.pet_id)}>
            <PetCard pet={pet} selected={pet.pet_id === selectedPet?.pet_id} compact />
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quick add pet</Text>
        <Field label="Pet name" value={name} onChangeText={setName} />
        <Field label="Species" value={species} onChangeText={setSpecies} autoCapitalize="none" />
        <Pressable
          disabled={saving || !name.trim()}
          style={[styles.primaryButton, (saving || !name.trim()) && styles.disabledButton]}
          onPress={async () => {
            setSaving(true);
            try {
              await request<Pet>("/pets", token, {
                method: "POST",
                body: JSON.stringify({ name: name.trim(), species: species.trim() || "dog" }),
              });
              setName("");
              setSpecies("dog");
              await onCreated();
            } catch (error) {
              onError(parseError(error));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Text style={styles.primaryButtonText}>{saving ? "Adding..." : "Add pet"}</Text>
        </Pressable>
      </View>

      <SectionTitle title={selectedPet ? `${selectedPet.name}'s records` : "Records"} />
      {records.length ? (
        records.slice(0, 12).map((record) => <RecordCard key={record.record_id} record={record} />)
      ) : (
        <EmptyState text="No records saved for this pet yet." />
      )}
    </View>
  );
}

function AnalyzeScreen({
  token,
  pets,
  selectedPet,
  onSelectPet,
}: {
  token: string;
  pets: Pet[];
  selectedPet?: Pet;
  onSelectPet: (petId: string) => void;
}) {
  const [typedText, setTypedText] = useState("");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<EstimateResult | null>(null);

  async function pickFile() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
      copyToCacheDirectory: true,
    });
    if (!picked.canceled) {
      setFile(picked.assets[0]);
      setNotice("");
    }
  }

  async function analyze() {
    setBusy(true);
    setNotice("");
    setResult(null);
    try {
      const form = new FormData();
      if (selectedPet) {
        form.append("pet_id", selectedPet.pet_id);
        form.append("pet_name", selectedPet.name);
        form.append("pet_species", selectedPet.species || "");
      }
      if (typedText.trim()) form.append("typed_text", typedText.trim());
      if (file) {
        form.append("file", {
          uri: file.uri,
          name: file.name || "petbill-upload",
          type: file.mimeType || "application/octet-stream",
        } as any);
      }

      const data = await request<EstimateResult>("/estimates/analyze", token, {
        method: "POST",
        body: form,
      });
      setResult(data);
    } catch (error) {
      setNotice(parseError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={styles.screenTitle}>Analyze a bill</Text>
      <Text style={styles.screenText}>
        Pick a PDF/photo or paste invoice text. The same backend analysis engine powers
        this mobile flow.
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.petRail}>
        {pets.map((pet) => (
          <Pressable key={pet.pet_id} onPress={() => onSelectPet(pet.pet_id)}>
            <PetChip pet={pet} selected={pet.pet_id === selectedPet?.pet_id} />
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Upload or paste bill</Text>
        <Pressable style={styles.secondaryButtonFull} onPress={pickFile}>
          <Text style={styles.secondaryButtonText}>
            {file ? file.name : "Choose PDF or image"}
          </Text>
        </Pressable>
        <TextInput
          value={typedText}
          onChangeText={setTypedText}
          multiline
          placeholder="Paste bill text here if you do not have a file."
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.textArea]}
        />
        {notice ? <InlineNotice tone="error" text={notice} /> : null}
        <Pressable
          disabled={busy || (!file && !typedText.trim())}
          style={[styles.primaryButton, (busy || (!file && !typedText.trim())) && styles.disabledButton]}
          onPress={analyze}
        >
          <Text style={styles.primaryButtonText}>{busy ? "Analyzing..." : "Run analysis"}</Text>
        </Pressable>
      </View>

      {result ? (
        <View style={styles.resultCard}>
          <Text style={styles.kicker}>Analysis ready</Text>
          <Text style={styles.cardTitle}>{result.pet_name || selectedPet?.name || "Pet"} bill</Text>
          <Text style={styles.screenText}>{result.summary || "Analysis complete."}</Text>
          {typeof result.estimated_total_usd === "number" ? (
            <Text style={styles.price}>${result.estimated_total_usd.toFixed(2)}</Text>
          ) : null}
          {(result.line_items || []).slice(0, 5).map((item, index) => (
            <Text key={`${item.item || item.name}-${index}`} style={styles.listLine}>
              {item.item || item.name || "Line item"} {item.urgency ? `- ${item.urgency}` : ""}
            </Text>
          ))}
          {(result.questions_to_ask_vet || []).slice(0, 3).map((question, index) => (
            <Text key={question} style={styles.questionLine}>
              {index + 1}. {question}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RemindersScreen({ reminders }: { reminders: Reminder[] }) {
  return (
    <View>
      <Text style={styles.screenTitle}>Reminders</Text>
      <Text style={styles.screenText}>
        Upcoming care tasks and renewal reminders from your PetBill Shield account.
      </Text>
      {reminders.length ? (
        reminders.map((reminder) => <ReminderCard key={reminder.reminder_id} reminder={reminder} />)
      ) : (
        <EmptyState text="No reminders yet." />
      )}
    </View>
  );
}

function SettingsScreen({
  apiBase,
  user,
  onSignOut,
}: {
  apiBase: string;
  user: User;
  onSignOut: () => void;
}) {
  return (
    <View>
      <Text style={styles.screenTitle}>Settings</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{user.name || "PetBill Shield user"}</Text>
        <Text style={styles.screenText}>{user.email}</Text>
        <Text style={styles.helpText}>Connected to {apiBase}</Text>
        <Pressable style={styles.secondaryButtonFull} onPress={onSignOut}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payments on mobile</Text>
        <Text style={styles.screenText}>
          Existing paid subscribers can use their account here. New mobile subscription
          purchase needs App Store and Play Store billing before public app release.
        </Text>
      </View>
    </View>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...rest}
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
      />
    </View>
  );
}

function ProfilePill({ user, onPress }: { user: User; onPress: () => void }) {
  const image = resolveAssetUrl(user.picture);
  const initial = (user.name || user.email || "U").trim().charAt(0).toUpperCase();
  return (
    <Pressable style={styles.profilePill} onPress={onPress}>
      {image ? <Image source={{ uri: image }} style={styles.avatar} /> : <Text style={styles.avatarText}>{initial}</Text>}
    </Pressable>
  );
}

function PetCard({ pet, selected, compact }: { pet: Pet; selected?: boolean; compact?: boolean }) {
  const image = resolveAssetUrl(pet.picture);
  return (
    <View style={[styles.petCard, selected && styles.petCardActive, compact && styles.petCardCompact]}>
      <View style={styles.petAvatar}>
        {image ? (
          <Image source={{ uri: image }} style={styles.petAvatarImage} />
        ) : (
          <Text style={styles.petAvatarText}>{pet.name.charAt(0).toUpperCase()}</Text>
        )}
      </View>
      <Text style={styles.petName}>{pet.name}</Text>
      <Text style={styles.petMeta}>
        {[pet.species, pet.breed].filter(Boolean).join(" / ") || "Pet profile"}
      </Text>
      {pet.is_active === false ? <Text style={styles.lockedText}>Inactive on current plan</Text> : null}
    </View>
  );
}

function PetChip({ pet, selected }: { pet: Pet; selected?: boolean }) {
  return (
    <View style={[styles.petChip, selected && styles.petChipActive]}>
      <Text style={[styles.petChipText, selected && styles.petChipTextActive]}>{pet.name}</Text>
    </View>
  );
}

function ReminderCard({ reminder }: { reminder: Reminder }) {
  const date = reminder.scheduled_for ? new Date(reminder.scheduled_for) : null;
  return (
    <View style={styles.listCard}>
      <Text style={styles.cardTitle}>{reminder.title}</Text>
      <Text style={styles.screenText}>
        {[reminder.pet_name, date && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString() : ""]
          .filter(Boolean)
          .join(" - ")}
      </Text>
      {reminder.message ? <Text style={styles.helpText}>{reminder.message}</Text> : null}
    </View>
  );
}

function RecordCard({ record }: { record: PetRecord }) {
  return (
    <View style={styles.listCard}>
      <Text style={styles.cardTitle}>{record.title}</Text>
      <Text style={styles.screenText}>
        {[record.record_type, record.date].filter(Boolean).join(" - ")}
      </Text>
      {record.details ? <Text style={styles.helpText}>{record.details}</Text> : null}
      {typeof record.amount_usd === "number" ? (
        <Text style={styles.priceSmall}>${record.amount_usd.toFixed(2)}</Text>
      ) : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SectionTitle({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onPress ? (
        <Pressable onPress={onPress}>
          <Text style={styles.linkText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.screenText}>{text}</Text>
    </View>
  );
}

function InlineNotice({ text, tone }: { text: string; tone: "error" | "info" }) {
  return (
    <View style={[styles.notice, tone === "error" ? styles.noticeError : styles.noticeInfo]}>
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const colors = {
  ink: "#16150f",
  panel: "#151a18",
  panelSoft: "#1d241f",
  panelWarm: "#231b13",
  line: "#3b423e",
  paper: "#eee8dc",
  muted: "#b7aea0",
  accent: "#d7795f",
  accentDark: "#8f321f",
  green: "#9aaf7b",
  gold: "#d8a82f",
  blue: "#74a7dc",
};

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  authWrap: {
    flex: 1,
  },
  authContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 22,
    gap: 24,
  },
  authHero: {
    gap: 14,
  },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: "#15140d",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMarkText: {
    color: colors.accentDark,
    fontWeight: "800",
  },
  brandTitle: {
    color: colors.paper,
    fontSize: 22,
    fontWeight: "700",
  },
  brandSub: {
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  shell: {
    flex: 1,
  },
  shellTablet: {
    flexDirection: "row",
  },
  nav: {
    maxHeight: 70,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  navTablet: {
    width: 220,
    maxHeight: "100%",
    borderBottomWidth: 0,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  navContent: {
    padding: 12,
    gap: 10,
  },
  navContentTablet: {
    flexDirection: "column",
    minWidth: 220,
  },
  navItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
  },
  navItemActive: {
    backgroundColor: colors.accentDark,
    borderColor: colors.accent,
  },
  navText: {
    color: colors.muted,
    fontWeight: "700",
  },
  navTextActive: {
    color: colors.paper,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 18,
    paddingBottom: 42,
    maxWidth: 980,
    width: "100%",
    alignSelf: "center",
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: colors.paper,
    fontSize: 44,
    lineHeight: 50,
    fontWeight: "700",
  },
  heroText: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 28,
  },
  heroPanel: {
    backgroundColor: colors.panelWarm,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
    gap: 14,
    marginBottom: 18,
  },
  screenTitle: {
    color: colors.paper,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    marginBottom: 8,
  },
  screenText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 14,
    marginTop: 16,
  },
  resultCard: {
    backgroundColor: "#22150f",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.accentDark,
    padding: 18,
    gap: 10,
    marginTop: 16,
  },
  cardTitle: {
    color: colors.paper,
    fontSize: 19,
    fontWeight: "800",
  },
  inputRow: {
    flexDirection: "row",
    gap: 12,
  },
  field: {
    flex: 1,
    gap: 7,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#101411",
    color: colors.paper,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  textArea: {
    minHeight: 130,
    paddingTop: 14,
    textAlignVertical: "top",
  },
  primaryButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff7ee",
    fontWeight: "800",
    fontSize: 16,
  },
  secondaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#111613",
  },
  secondaryButtonFull: {
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#111613",
    width: "100%",
  },
  secondaryButtonText: {
    color: colors.paper,
    fontWeight: "800",
    fontSize: 15,
  },
  disabledButton: {
    opacity: 0.55,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: "#100f0b",
    borderRadius: 18,
    padding: 5,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 14,
  },
  segmentActive: {
    backgroundColor: colors.paper,
  },
  segmentText: {
    color: colors.muted,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: colors.ink,
  },
  helpText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  notice: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginVertical: 10,
  },
  noticeError: {
    backgroundColor: "#3a170d",
    borderColor: colors.accentDark,
  },
  noticeInfo: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.green,
  },
  noticeText: {
    color: colors.paper,
    lineHeight: 22,
  },
  profilePill: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatar: {
    width: 46,
    height: 46,
  },
  avatarText: {
    color: colors.paper,
    fontWeight: "900",
    fontSize: 18,
  },
  metricGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  metricValue: {
    color: colors.accent,
    fontSize: 30,
    fontWeight: "800",
  },
  metricLabel: {
    color: colors.muted,
    fontWeight: "700",
  },
  sectionTitleRow: {
    marginTop: 20,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.paper,
    fontSize: 18,
    fontWeight: "900",
  },
  linkText: {
    color: colors.accent,
    fontWeight: "800",
  },
  petRail: {
    marginVertical: 12,
  },
  petCard: {
    width: 210,
    minHeight: 170,
    backgroundColor: colors.panel,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginRight: 12,
    gap: 8,
  },
  petCardCompact: {
    width: 170,
    minHeight: 150,
  },
  petCardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.panelWarm,
  },
  petAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  petAvatarImage: {
    width: 54,
    height: 54,
  },
  petAvatarText: {
    color: colors.accentDark,
    fontWeight: "900",
    fontSize: 20,
  },
  petName: {
    color: colors.paper,
    fontSize: 22,
    fontWeight: "900",
  },
  petMeta: {
    color: colors.muted,
    fontSize: 14,
  },
  lockedText: {
    color: colors.gold,
    fontWeight: "800",
    fontSize: 12,
  },
  petChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
  },
  petChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  petChipText: {
    color: colors.muted,
    fontWeight: "800",
  },
  petChipTextActive: {
    color: colors.paper,
  },
  listCard: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 10,
    gap: 6,
  },
  emptyState: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
  },
  price: {
    color: colors.accent,
    fontSize: 34,
    fontWeight: "800",
  },
  priceSmall: {
    color: colors.accent,
    fontWeight: "800",
  },
  listLine: {
    color: colors.paper,
    fontSize: 15,
    lineHeight: 24,
  },
  questionLine: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
  },
  muted: {
    color: colors.muted,
  },
});
