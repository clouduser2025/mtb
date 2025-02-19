import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUserCog, 
  faUserPlus, 
  faUsers, 
  faSignInAlt, 
  faShoppingCart, 
  faExchangeAlt,
  faUser,               
  faUserTie,
  faChartLine,
  faDollarSign,
  faChartBar,
  faHourglassHalf,
  faBullseye,
  faMapMarkerAlt
} from '@fortawesome/free-solid-svg-icons'; 
import './css/landing.css';

const Landing = () => {
  /********************************************************
   *           STATES & REGISTRATION SETUP              *
   ********************************************************/
  const [users, setUsers] = useState([]); 
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [openTrades, setOpenTrades] = useState([]);  
  const [showTradesDashboard, setShowTradesDashboard] = useState(false);

  const [formStep, setFormStep] = useState(1); // 1: Select Users, 2: Stop-Loss/Stop-Gain, 3: Buy/Sell
  const [actionType, setActionType] = useState(null); // 'buy' or 'sell'

  const [formData, setFormData] = useState({
    username: "",
    password: "",
    broker: "Angel",
    api_key: "",
    totp_token: "",
    symbol: "",
    default_quantity: "",
    stopLossType: "Fixed",
    stopLossValue: 95,
    pointsCondition: 0,
    buyStrategy: "Fixed Value",
    buyConditionValue: 0,
    sellStrategy: "Fixed Value",
    sellConditionValue: 0,
  });
  
  /********************************************************
   *         PRICE SIMULATION & TRADING SETUP           *
   ********************************************************/
  const [currentPrice, setCurrentPrice] = useState(90); 
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationRef = useRef(null);

  const [buyThreshold, setBuyThreshold] = useState(100);
  const [sellThreshold, setSellThreshold] = useState(120);
  const [entryPrice, setEntryPrice] = useState(null);

  const [exchange, setExchange] = useState("NSE");
  const [ltpSymbol, setLtpSymbol] = useState("");
  const [symbolToken, setSymbolToken] = useState("");
  const [ltpPrice, setLtpPrice] = useState(null);
  const [loadingLtp, setLoadingLtp] = useState(false);

  /********************************************************
   *                 API FUNCTIONS                      *
   ********************************************************/
  const fetchLtp = async () => {
    if (!ltpSymbol) {
      alert("Please enter a stock symbol.");
      return;
    }
    setLoadingLtp(true);
    try {
      const response = await fetch(`https://mtb-2-xk0d.onrender.com/api/fetch_ltp?exchange=${exchange}&symbol=${ltpSymbol}&token=${symbolToken}`);
      const data = await response.json();
      if (response.status) {
        setLtpPrice(data.ltp);
      } else {
        setLtpPrice(null);
        alert("Failed to fetch LTP. Please check the symbol.");
      }
    } catch (error) {
      console.error("Error fetching LTP:", error);
      alert("Server error. Try again later.");
    } finally {
      setLoadingLtp(false);
    }
  };

  const fetchTrades = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_trades");
      if (!response.ok) {
        throw new Error("Failed to fetch trades");
      }
      const data = await response.json();
      const updatedTrades = data.trades.map(trade => ({
        ...trade,
        user_role: trade.user_role || "Trader",
      }));
      setOpenTrades(updatedTrades);
    } catch (error) {
      console.error("Error fetching trades:", error);
    }
  };

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => (
    <Dropdown as={ButtonGroup}>
      <Dropdown.Toggle variant="primary" id="dropdown-basic" className="user-actions-dropdown">
        <FontAwesomeIcon icon={faUserCog} />
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => setShowRegisterModal(true)}>
          <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
        </Dropdown.Item>
        <Dropdown.Item onClick={() => setShowUsers(!showUsers)}>
          <FontAwesomeIcon icon={faUsers} className="me-2" /> View Users
        </Dropdown.Item>
        <Dropdown.Item onClick={() => window.open('https://www.angelone.in/login/?redirectUrl=account', '_blank')}>
          <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Angel Login
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );

  const fetchUsers = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_users", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
      setUsers(data.users);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/register_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          broker: formData.broker,
          api_key: formData.api_key,
          totp_token: formData.totp_token,
          default_quantity: parseInt(formData.default_quantity, 10),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: "User registered successfully!", type: "success" });
        fetchUsers();
        setFormData({
          username: "",
          password: "",
          broker: "Angel",
          api_key: "",
          totp_token: "",
          default_quantity: "",
          symbol: "",
          stopLossType: "Fixed",
          stopLossValue: 95,
          pointsCondition: 0,
          buyStrategy: "Fixed Value",
          buyConditionValue: 0,
          sellStrategy: "Fixed Value",
          sellConditionValue: 0,
        });
      } else {
        setMessage({ text: data.detail || "Registration failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const handleDeleteUser = async (username) => {
    try {
      const response = await fetch(`https://mtb-8ra9.onrender.com/api/delete_user/${username}`, {
        method: "DELETE"
      });
      const data = await response.json();
      if (response.ok) {
        setUsers(users.filter(user => user.username !== username));
        setMessage({ text: "User deleted successfully!", type: "success" });
      } else {
        setMessage({ text: data.detail || "Failed to delete user", type: "danger" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const AdvancedChart = ({ symbol, openTrades }) => {
    const chartContainerRef = useRef(null);
    const tvWidgetRef = useRef(null);

    useEffect(() => {
      loadTradingViewScript(() => {
        if (!window.TradingView) return;
        tvWidgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol: symbol || "NASDAQ:AAPL",
          interval: "5",
          container_id: "advanced_chart_container",
          datafeed: window.TradingView.defaultDatafeed,
          library_path: "/charting_library/",
          locale: "en",
          disabled_features: ["header_saveload"],
          enabled_features: [],
          onChartReady: () => console.log("Advanced chart is ready"),
        });
      });
    }, [symbol]);

    const updateMarkers = (trades) => {
      if (!tvWidgetRef.current) return;
      if (typeof tvWidgetRef.current.on !== "function") return;
      tvWidgetRef.current.on("chart_ready", () => {
        const chart = tvWidgetRef.current.chart();
        const currentTime = Math.floor(Date.now() / 1000);
        let priceOffset = {};
        trades.forEach((trade) => {
          const basePrice = trade.entry_price;
          if (!priceOffset[basePrice]) priceOffset[basePrice] = 0;
          else priceOffset[basePrice] += 0.5;
          const userIcons = {
            "John": { icon: "👨‍💼", color: "🔵" },
            "Alice": { icon: "👩‍💼", color: "🟢" },
            "Bob": { icon: "🧑‍💻", color: "🟠" }
          };
          const userData = userIcons[trade.username] || { icon: "🧑‍💻", color: "⚪" };
          chart.createShape(
            { time: currentTime, price: basePrice + priceOffset[basePrice] },
            {
              shape: trade.position_type === "LONG" ? "arrow_up" : "arrow_down",
              text: `${userData.color} ${userData.icon} ${trade.username}\n(${trade.user_role})`,
              color: trade.position_type === "LONG" ? "green" : "red",
              disableUndo: true
            }
          );
        });
      });
    };

    useEffect(() => {
      if (tvWidgetRef.current) updateMarkers(openTrades);
    }, [openTrades]);

    return <div id="advanced_chart_container" ref={chartContainerRef} style={{ height: "500px", width: "100%" }}></div>;
  };

  const loadTradingViewScript = (callback) => {
    if (window.TradingView) {
      callback();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = callback;
    document.body.appendChild(script);
  };

  /********************************************************
   *                     RENDER (JSX)                     *
   ********************************************************/
  return (
    <>
      <Container className="mt-4">
        <Row className="justify-content-end mb-3" style={{ position: "absolute", top: "9%", right: "10px", zIndex: "1000" }}>
          <Col xs="auto">
            <UserActionsDropdown 
              setShowRegisterModal={setShowRegisterModal} 
              setShowUsers={setShowUsers} 
              showUsers={showUsers} 
            />
          </Col>
        </Row>

        {showUsers && (
          <Container className="users-table-container mb-5">
            <h3 className="text-center mb-4 text-primary">
              <FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users
            </h3>
            <div className="table-responsive">
              <Table striped bordered hover className="users-table shadow-sm">
                <thead>
                  <tr>
                    <th className="table-header bg-primary text-white">#</th>
                    <th className="table-header bg-success text-white">Username</th>
                    <th className="table-header bg-info text-white">Role</th>
                    <th className="table-header bg-warning text-dark">Broker</th>
                    <th className="table-header bg-danger text-white">Default Quantity</th>
                    <th className="table-header bg-dark text-white">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length > 0 ? (
                    users.map((user, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>{user.username}</td>
                        <td>{user.role || "Trader"}</td>
                        <td>{user.broker}</td>
                        <td>{user.default_quantity}</td>
                        <td>
                          <Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.username)}>
                            ❌ Delete
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="text-muted text-center">No registered users found.</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </Container>
        )}

        {showTradesDashboard && (
          <>
            <Container className="mt-5 p-4 traders-table-container shadow-lg rounded bg-white">
              <h3 className="text-center mb-4 text-dark fw-bold">
                <FontAwesomeIcon icon={faExchangeAlt} className="me-2 text-primary" /> Active Trades
              </h3>
              <div className="table-responsive">
                <Table striped bordered hover className="traders-table shadow-sm">
                  <thead className="text-center">
                    <tr>
                      <th>#</th>
                      <th className="bg-primary text-white"><FontAwesomeIcon icon={faUser} /> Username</th>
                      <th className="bg-success text-white"><FontAwesomeIcon icon={faUserTie} /> Role</th>
                      <th className="bg-info text-white"><FontAwesomeIcon icon={faChartLine} /> Symbol</th>
                      <th className="bg-dark text-white"><FontAwesomeIcon icon={faDollarSign} /> Entry Price</th>
                      <th className="bg-danger text-white"><FontAwesomeIcon icon={faChartBar} /> Threshold</th>
                      <th className="bg-secondary text-white"><FontAwesomeIcon icon={faHourglassHalf} /> Exit Type</th>
                      <th className="bg-primary text-white"><FontAwesomeIcon icon={faBullseye} /> Exit Value</th>
                      <th className="bg-warning text-dark"><FontAwesomeIcon icon={faMapMarkerAlt} /> Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.length > 0 ? (
                      openTrades.map((trade, index) => (
                        <tr key={index} className="align-middle text-center">
                          <td><strong className="text-secondary">{index + 1}</strong></td>
                          <td className="fw-bold text-warning">{trade.username}</td>
                          <td><span className={`badge ${trade.user_role === "Admin" ? "bg-danger" : "bg-secondary"}`}>{trade.user_role}</span></td>
                          <td className="text-primary fw-bold">{trade.symbol}</td>
                          <td className="text-success fw-bold">₹{trade.entry_price}</td>
                          <td className="text-danger fw-bold">{trade.position_type === "LONG" ? trade.buy_threshold : trade.sell_threshold}</td>
                          <td className="text-warning">{trade.exit_condition_type}</td>
                          <td className="text-info">{trade.exit_condition_value}</td>
                          <td><span className={`badge ${trade.position_type === "LONG" ? "bg-success" : "bg-danger"}`}>{trade.position_type === "LONG" ? "🔼 Buy" : "🔽 Sell"}</span></td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="9" className="text-muted text-center">No active trades found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </Container>
            <Container className="mt-5 p-4 bg-light rounded shadow-lg">
              <h4 className="text-center mb-3 text-dark fw-bold">📊 Live Chart with Open Trades</h4>
              <AdvancedChart symbol={formData.symbol} openTrades={openTrades} />
            </Container>
          </>
        )}

        <Row className="justify-content-center mb-3">
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/markets/equity/overview', '_blank')} className="gradient-button btn-market">
              Market Overview
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/indices/indian', '_blank')} className="gradient-button btn-indices">
              Indices
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/chart', '_blank')} className="gradient-button btn-chart">
              Chart
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/option-chain', '_blank')} className="gradient-button btn-option">
              Option Chain
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={fetchLtp} className="gradient-button btn-ltp">Fetch LTP</Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchTrades(); }} className="gradient-button btn-trades">
              Trades Dashboard
            </Button>
          </Col>
        </Row>

        <Container className="ltp-container">
          <h4 className="text-primary">🔍 Live Fetch LTP</h4>
          <Form onSubmit={(e) => { e.preventDefault(); fetchLtp(); }}>
            <Row className="mb-3">
              <Col md={3}>
                <Form.Group controlId="exchange">
                  <Form.Label>Select Exchange</Form.Label>
                  <Form.Select value={exchange} onChange={(e) => setExchange(e.target.value)}>
                    <option value="NSE">NSE</option>
                    <option value="BSE">BSE</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="ltpSymbol">
                  <Form.Label>Enter Stock Symbol</Form.Label>
                  <Form.Control type="text" placeholder="e.g. RELIANCE" value={ltpSymbol} onChange={(e) => setLtpSymbol(e.target.value)} required />
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="symbolToken">
                  <Form.Label>Enter Symbol Token (Optional)</Form.Label>
                  <Form.Control type="text" placeholder="e.g. 3045" value={symbolToken} onChange={(e) => setSymbolToken(e.target.value)} />
                </Form.Group>
              </Col>
              <Col md={2}>
                <Button type="submit" variant="primary" className="mt-4">Fetch LTP</Button>
              </Col>
            </Row>
          </Form>
          {loadingLtp && <p>Loading...</p>}
          {ltpPrice !== null && (
            <Alert variant="success">📈 Latest Price of <strong>{ltpSymbol}</strong>: ₹{ltpPrice}</Alert>
          )}
        </Container>

        {/* Multi-Step Trade Form */}
        <Container className="mt-4 p-3 border rounded shadow-sm">
          {formStep === 1 && (
            <>
              <h4 className="text-primary">
                <FontAwesomeIcon icon={faUsers} /> Select Users (1 to 3)
              </h4>
              <Form>
                <Row className="mb-3">
                  <Col>
                    {users.map((user, index) => (
                      <Form.Check
                        key={index}
                        type="checkbox"
                        label={user.username}
                        checked={selectedUsers.includes(user.username)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (selectedUsers.length < 3) {
                              setSelectedUsers([...selectedUsers, user.username]);
                            } else {
                              alert("⚠ You can only select up to 3 users.");
                            }
                          } else {
                            setSelectedUsers(selectedUsers.filter(u => u !== user.username));
                          }
                        }}
                      />
                    ))}
                  </Col>
                </Row>
                <Button 
                  variant="primary" 
                  onClick={() => {
                    if (selectedUsers.length === 0) {
                      alert("Please select at least 1 user.");
                    } else {
                      setFormStep(2);
                    }
                  }}
                  className="mt-3"
                >
                  Next
                </Button>
              </Form>
            </>
          )}

          {formStep === 2 && (
            <>
              <h4 className="text-primary">
                <FontAwesomeIcon icon={faBullseye} /> Stop-Loss/Stop-Gain Settings
              </h4>
              <Form>
                <Row className="mb-3">
                  <Col md={4}>
                    <Form.Group controlId="stopLossType">
                      <Form.Label>Stop-Loss/Stop-Gain Type</Form.Label>
                      <Form.Select 
                        value={formData.stopLossType} 
                        onChange={(e) => setFormData({ ...formData, stopLossType: e.target.value })}
                      >
                        <option value="Fixed">Fixed</option>
                        <option value="Percentage">Percentage</option>
                        <option value="Points">Points</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="stopLossValue">
                      <Form.Label>Stop-Loss/Stop-Gain Value</Form.Label>
                      <Form.Control 
                        type="number" 
                        value={formData.stopLossValue} 
                        onChange={(e) => setFormData({ ...formData, stopLossValue: Number(e.target.value) })} 
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="pointsCondition">
                      <Form.Label>Points Condition</Form.Label>
                      <Form.Control 
                        type="number" 
                        value={formData.pointsCondition} 
                        onChange={(e) => setFormData({ ...formData, pointsCondition: Number(e.target.value) })} 
                      />
                    </Form.Group>
                  </Col>
                </Row>
                <Button 
                  variant="primary" 
                  onClick={() => setFormStep(3)}
                  className="mt-3"
                >
                  Next
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={() => { setFormStep(1); setSelectedUsers([]); }}
                  className="mt-3 ms-2"
                >
                  Back
                </Button>
              </Form>
            </>
          )}

          {formStep === 3 && (
            <>
              <h4 className={actionType === 'buy' ? "text-success" : "text-danger"}>
                {actionType === 'buy' ? (
                  <FontAwesomeIcon icon={faShoppingCart} /> Buy with Stop-Loss
                ) : (
                  <FontAwesomeIcon icon={faExchangeAlt} /> Sell with Stop-Loss
                )}
              </h4>
              <Form>
                <Row className="mb-3">
                  {actionType === 'buy' && (
                    <>
                      <Col md={4}>
                        <Form.Group controlId="buyStrategy">
                          <Form.Label>Buy Strategy</Form.Label>
                          <Form.Select 
                            value={formData.buyStrategy} 
                            onChange={(e) => setFormData({ ...formData, buyStrategy: e.target.value })}
                          >
                            <option value="Fixed Value">Fixed Value</option>
                            <option value="Percentage">Percentage</option>
                            <option value="Points">Points</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group controlId="buyConditionValue">
                          <Form.Label>Buy Condition Value</Form.Label>
                          <Form.Control 
                            type="number" 
                            value={formData.buyConditionValue} 
                            onChange={(e) => setFormData({ ...formData, buyConditionValue: Number(e.target.value) })} 
                          />
                        </Form.Group>
                      </Col>
                    </>
                  )}
                  {actionType === 'sell' && (
                    <>
                      <Col md={4}>
                        <Form.Group controlId="sellStrategy">
                          <Form.Label>Sell Strategy</Form.Label>
                          <Form.Select 
                            value={formData.sellStrategy} 
                            onChange={(e) => setFormData({ ...formData, sellStrategy: e.target.value })}
                          >
                            <option value="Fixed Value">Fixed Value</option>
                            <option value="Percentage">Percentage</option>
                            <option value="Points">Points</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group controlId="sellConditionValue">
                          <Form.Label>Sell Condition Value</Form.Label>
                          <Form.Control 
                            type="number" 
                            value={formData.sellConditionValue} 
                            onChange={(e) => setFormData({ ...formData, sellConditionValue: Number(e.target.value) })} 
                          />
                        </Form.Group>
                      </Col>
                    </>
                  )}
                </Row>
                <Row className="mb-3">
                  <Col md={4}>
                    <Form.Group controlId="symbol">
                      <Form.Label>Symbol</Form.Label>
                      <Form.Control 
                        type="text" 
                        placeholder="Enter Stock Symbol" 
                        value={formData.symbol} 
                        onChange={(e) => setFormData({ ...formData, symbol: e.target.value })} 
                      />
                    </Form.Group>
                  </Col>
                </Row>
                <Button 
                  variant="primary" 
                  onClick={() => {
                    console.log("Trade submitted:", {
                      actionType,
                      selectedUsers,
                      ...formData,
                    });
                    setFormStep(1); // Reset to the first step
                    setSelectedUsers([]);
                    setActionType(null);
                    setFormData({
                      username: "",
                      password: "",
                      broker: "Angel",
                      api_key: "",
                      totp_token: "",
                      symbol: "",
                      default_quantity: "",
                      stopLossType: "Fixed",
                      stopLossValue: 95,
                      pointsCondition: 0,
                      buyStrategy: "Fixed Value",
                      buyConditionValue: 0,
                      sellStrategy: "Fixed Value",
                      sellConditionValue: 0,
                    });
                  }}
                  className="mt-3"
                >
                  Submit Trade
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={() => setFormStep(2)}
                  className="mt-3 ms-2"
                >
                  Back
                </Button>
              </Form>
            </>
          )}
        </Container>

        <Row className="justify-content-center mb-3">
          <Col xs="auto">
            <Button onClick={() => { setActionType('buy'); setFormStep(1); }} className="gradient-button btn-buy">
              <FontAwesomeIcon icon={faShoppingCart} /> Buy
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => { setActionType('sell'); setFormStep(1); }} className="gradient-button btn-sell">
              <FontAwesomeIcon icon={faExchangeAlt} /> Sell
            </Button>
          </Col>
        </Row>
      </Container>

      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message.text && <Alert variant={message.type}>{message.text}</Alert>}
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group controlId="username">
              <Form.Label>Username</Form.Label>
              <Form.Control type="text" placeholder="Enter username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="password">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" placeholder="Enter password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="broker">
              <Form.Label>Broker</Form.Label>
              <Form.Select value={formData.broker} onChange={(e) => setFormData({ ...formData, broker: e.target.value })}>
                <option value="Angel">Angel</option>
                <option value="Zerodha">Zerodha</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="api_key">
              <Form.Label>API Key</Form.Label>
              <Form.Control type="text" placeholder="Enter API Key" value={formData.api_key} onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="totp_token">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control type="text" placeholder="Enter TOTP Token" value={formData.totp_token} onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="default_quantity">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control type="number" placeholder="Enter Quantity" value={formData.default_quantity} onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} required />
            </Form.Group>
            <Button variant="primary" type="submit" className="mt-3">Register</Button>
          </Form>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default Landing;