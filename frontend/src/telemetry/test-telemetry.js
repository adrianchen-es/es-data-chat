// Quick test script to demonstrate OpenTelemetry functionality
// Run this in browser console to see telemetry in action

console.log('🔧 Testing OpenTelemetry Integration...');

// Import telemetry (if available globally)
if (window.telemetry) {
  console.log('✅ Telemetry object available');
  
  // Test span creation
  const testSpan = window.telemetry.createSpan('test_span', {
    'test.attribute': 'test_value',
    'component': 'test'
  });
  
  // Simulate some work
  setTimeout(() => {
    testSpan.setAttributes({
      'test.completed': true,
      'test.duration': 'short'
    });
    testSpan.end();
    console.log('✅ Test span created and completed');
  }, 100);
  
  // Test user action tracking
  window.telemetry.trackUserAction('test_user_action', {
    'action.type': 'test',
    'action.source': 'console'
  });
  console.log('✅ User action tracked');
  
  // Show recent events
  setTimeout(() => {
    const events = window.telemetry.getEvents();
    console.log('📊 Recent telemetry events:', events.slice(-3));
  }, 200);
  
} else {
  console.log('❌ Telemetry not available on window object');
}

console.log('🎯 OpenTelemetry test completed');
