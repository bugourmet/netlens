namespace NetLens.App;

public partial class App : Application
{
	public App()
	{
		InitializeComponent();
	}

	protected override Window CreateWindow(IActivationState? activationState)
	{
		return new Window(new MonitorPage()) { Title = "NetLens", Width = 1360, Height = 860, MinimumWidth = 420, MinimumHeight = 500 };
	}
}