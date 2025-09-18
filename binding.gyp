{
  "targets": [
    {
      "target_name": "wechat_monitor",
      "sources": [ "src/wechat_monitor.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cxxflags!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS=='win'", { "libraries": [ "user32.lib", "dwmapi.lib" ] }]
      ]
    }
  ]
}