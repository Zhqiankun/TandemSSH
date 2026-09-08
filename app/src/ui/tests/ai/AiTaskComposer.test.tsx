import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import i18n from "../../i18n/i18n";
const mocks=vi.hoisted(()=>({status:vi.fn(),providers:vi.fn(),preferences:vi.fn(),create:vi.fn()}));
vi.mock("@/api/ai-api",()=>({getAiStatus:mocks.status,getAiProviders:mocks.providers}));
vi.mock("@/main-axios",()=>({saveUserPreferences:mocks.preferences}));
vi.mock("@/api/ai-task-api",()=>({aiTaskApi:{create:mocks.create}}));
vi.mock("../../features/ai/AiProviderSettings",()=>({AiProviderSettings:()=>null}));
import { AiTaskComposer } from "../../features/ai/tasks/AiTaskComposer";
beforeEach(async()=>{vi.clearAllMocks();await i18n.changeLanguage("zh-CN");mocks.status.mockResolvedValue({globallyEnabled:true,enabled:false});mocks.providers.mockResolvedValue([{id:1,label:"我的模型",defaultModel:"custom-model",enabled:true}]);mocks.preferences.mockResolvedValue({});mocks.create.mockResolvedValue({task:{id:"task"}});});
afterEach(cleanup);
describe("Chinese BYOK task creation",()=>{
 it("requires a goal and uses the chosen provider, model, mode and explicit call budget",async()=>{
  render(<AiTaskComposer sessionId="session" onCreate={action=>action()}/>);await screen.findByText("我的模型");expect(mocks.preferences).toHaveBeenCalledWith({aiAssistantEnabled:true});
  expect((screen.getByRole("button",{name:"让 AI 规划"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("执行目标"),{target:{value:"检查目录"}});fireEvent.change(screen.getByLabelText("模型调用预算（含规划）"),{target:{value:"6"}});fireEvent.click(screen.getByRole("radio",{name:/自动执行/}));fireEvent.click(screen.getByRole("button",{name:"让 AI 规划"}));
  await waitFor(()=>expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({sessionId:"session",providerId:1,model:"custom-model",goal:"检查目录",mode:"automatic",maxTurns:6})));
 });
 it("respects an explicit global off switch without enabling the user or calling a model",async()=>{
  mocks.status.mockResolvedValue({globallyEnabled:false,enabled:false});render(<AiTaskComposer sessionId="session" onCreate={action=>action()}/>);await screen.findByRole("alert");expect(mocks.preferences).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
 });
});
