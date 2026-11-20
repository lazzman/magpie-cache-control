package cachecontrol

import (
	"os"
	"testing"

	"github.com/MoeForge/moejs"
)

func compilePlugin(t *testing.T) *moejs.Module {
	t.Helper()
	plugin, err := os.ReadFile("../../cache-control.middleware.js")
	if err != nil {
		t.Fatal(err)
	}
	contracts, err := os.ReadFile("../contracts.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(plugin) + "\n" + string(contracts) + `
const console = { log() {} }
export function runContract() {
  const results = []
  for (const entry of contractCases({ onRequest, onProvider, onEvent, onResponse })) {
    try {
      entry.run()
      results.push({ name: entry.name, passed: true })
    } catch (error) {
      results.push({ name: entry.name, passed: false, error: String(error) })
    }
  }
  return results
}
export function runtimeMarker() {
  const ctx = context("responses")
  onRequest({ input: [] }, ctx)
  return markerOf(ctx)
}
export function runtimeScheduledMarker() {
  const ctx = context("chat", { rotation: { strategy: "turns", turns: 3 } })
  const body = { messages: [{ role: "user", content: "first question" }] }
  onRequest(body, ctx)
  equal(body, { messages: [{ role: "user", content: "first question" }] })
  ensure(ctx.state.cacheControl.salted === false)
  return JSON.stringify(body)
}
export function runtimeThresholdTailMarker() {
  const ctx = context("chat", { rotation: { strategy: "turns", turns: 1 } })
  const body = { messages: [{ role: "user", content: "first question" }, { role: "assistant", content: "answer" }, { role: "user", content: "second question" }] }
  onRequest(body, ctx)
  equal(body.messages[0], { role: "user", content: "first question" })
  ensure(body.messages[2].content.startsWith(markerOf(ctx)))
  return markerOf(ctx)
}
`
	module, err := moejs.Compile("cache-control.middleware.js", source)
	if err != nil {
		t.Fatal(err)
	}
	return module
}

func TestContractsInMoejs(t *testing.T) {
	module := compilePlugin(t)
	runtime := moejs.NewRuntime(moejs.Options{})
	if err := runtime.Load(module); err != nil {
		t.Fatal(err)
	}
	hook, err := module.Hook("runContract")
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtime.Call(hook)
	if err != nil {
		t.Fatal(err)
	}
	var results []struct {
		Name   string
		Passed bool
		Error  string
	}
	if err := runtime.Unmarshal(result, &results); err != nil {
		t.Fatal(err)
	}
	if len(results) == 0 {
		t.Fatal("contract suite did not run")
	}
	for _, result := range results {
		t.Run(result.Name, func(t *testing.T) {
			if !result.Passed {
				t.Fatal(result.Error)
			}
		})
	}
	t.Logf("%d shared contracts executed in moejs", len(results))
}

func TestNonceAcrossFreshRuntimes(t *testing.T) {
	module := compilePlugin(t)
	hook, err := module.Hook("runtimeMarker")
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool)
	for index := 0; index < 128; index++ {
		runtime := moejs.NewRuntime(moejs.Options{})
		if err := runtime.Load(module); err != nil {
			t.Fatal(err)
		}
		result, err := runtime.Call(hook)
		if err != nil {
			t.Fatal(err)
		}
		var marker string
		if err := runtime.Unmarshal(result, &marker); err != nil {
			t.Fatal(err)
		}
		if marker == "" || seen[marker] {
			t.Fatalf("marker repeated across fresh runtimes: %q", marker)
		}
		seen[marker] = true
	}
}

func TestThresholdWarmupAcrossFreshRuntimes(t *testing.T) {
	module := compilePlugin(t)
	hook, err := module.Hook("runtimeScheduledMarker")
	if err != nil {
		t.Fatal(err)
	}
	var expected string
	for index := 0; index < 32; index++ {
		runtime := moejs.NewRuntime(moejs.Options{})
		if err := runtime.Load(module); err != nil {
			t.Fatal(err)
		}
		result, err := runtime.Call(hook)
		if err != nil {
			t.Fatal(err)
		}
		var marker string
		if err := runtime.Unmarshal(result, &marker); err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			expected = marker
		}
		if marker == "" || marker != expected {
			t.Fatalf("warmup request changed across fresh runtimes: %q", marker)
		}
	}
}

func TestThresholdTailNonceAcrossFreshRuntimes(t *testing.T) {
	module := compilePlugin(t)
	hook, err := module.Hook("runtimeThresholdTailMarker")
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool)
	for index := 0; index < 32; index++ {
		runtime := moejs.NewRuntime(moejs.Options{})
		if err := runtime.Load(module); err != nil {
			t.Fatal(err)
		}
		result, err := runtime.Call(hook)
		if err != nil {
			t.Fatal(err)
		}
		var marker string
		if err := runtime.Unmarshal(result, &marker); err != nil {
			t.Fatal(err)
		}
		if marker == "" || seen[marker] {
			t.Fatalf("tail marker was reused across identical post-threshold requests: %q", marker)
		}
		seen[marker] = true
	}
}
